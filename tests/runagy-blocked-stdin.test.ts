import { assertEquals, assertStringIncludes } from "@std/assert";

function getFreePort(): number {
  const listener = Deno.listen({ port: 0, hostname: "127.0.0.1" });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

async function waitForHealth(port: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (res.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`bridge never became healthy on port ${port}`);
}

Deno.test("hard deadline covers blocked stdin, releases concurrency gate, and preserves SIGKILL escalation", async () => {
  const port = getFreePort();
  const homeDir = await Deno.makeTempDir({ prefix: "agy_blocked_home_" });
  const stateDir = await Deno.makeTempDir({ prefix: "agy_blocked_state_" });
  const binDir = await Deno.makeTempDir({ prefix: "agy_blocked_bin_" });
  const mockAgyPath = `${binDir}/agy`;

  const mockScript = `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = "models" ]; then
  printf "gemini-2.5-pro\\tGemini 2.5 Pro\\n"
  exit 0
fi

count_file="$HOME/blocked-stdin-count"
count=0
if [ -f "$count_file" ]; then
  count="$(cat "$count_file")"
fi
count=$((count + 1))
printf '%s' "$count" > "$count_file"

if [ "$count" -eq 1 ]; then
  printf '%s' "$$" > "$HOME/blocked-stdin.pid"
  trap '' TERM
  # Keep stdin open but never read it. The bridge write is intentionally much
  # larger than a pipe buffer, so only the bridge hard deadline can unblock it.
  while true; do sleep 1; done
fi

read -r line
printf '{"event":"result","result":{"status":"SUCCESS","response":"second request ok","conversation_id":"after-blocked-stdin","usage":{"input_tokens":1,"output_tokens":1}}}\\n'
`;

  await Deno.writeTextFile(mockAgyPath, mockScript);
  await Deno.chmod(mockAgyPath, 0o755);

  const process = new Deno.Command("deno", {
    args: [
      "run",
      `--allow-net=127.0.0.1:${port}`,
      `--allow-run=${mockAgyPath}`,
      `--allow-read=${homeDir}/.gemini,${Deno.cwd()}`,
      `--allow-write=${stateDir}`,
      "--allow-env",
      "agy-bridge.ts",
    ],
    cwd: Deno.cwd(),
    env: {
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      HOME: homeDir,
      STATE_DIR: stateDir,
      AGY_BIN: mockAgyPath,
      PATH: `${binDir}:${Deno.env.get("PATH") ?? ""}`,
      PRINT_TIMEOUT: "1s",
      AGY_HARD_MARGIN_MS: "100",
      AGY_TOKEN: "",
      AGY_REUSE: "off",
    },
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  try {
    await waitForHealth(port);

    const firstStarted = Date.now();
    const first = await fetch(
      `http://127.0.0.1:${port}/v1/chat/completions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(7_000),
        body: JSON.stringify({
          model: "gemini-2.5-pro",
          messages: [{
            role: "user",
            content: "x".repeat(4 * 1024 * 1024),
          }],
        }),
      },
    );
    const firstDuration = Date.now() - firstStarted;

    assertEquals(first.status, 502);
    const firstBody = await first.json();
    assertStringIncludes(
      firstBody.error?.message,
      "agy hard deadline exceeded",
    );
    assertEquals(firstDuration < 7_000, true);

    // This request must not sit behind a leaked MAX_CONCURRENT=1 permit.
    const second = await fetch(
      `http://127.0.0.1:${port}/v1/chat/completions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(5_000),
        body: JSON.stringify({
          model: "gemini-2.5-pro",
          messages: [{ role: "user", content: "after timeout" }],
        }),
      },
    );
    assertEquals(second.status, 200);
    const secondBody = await second.json();
    assertEquals(secondBody.choices[0].message.content, "second request ok");

    // The first mock ignores SIGTERM. The escalation timer must survive the
    // request cleanup and kill that process with SIGKILL after the grace period.
    const hungPid = (await Deno.readTextFile(`${homeDir}/blocked-stdin.pid`))
      .trim();
    const killDeadline = Date.now() + 5_000;
    let stillAlive = true;
    while (Date.now() < killDeadline) {
      const probe = await new Deno.Command("bash", {
        args: ["-lc", `kill -0 ${hungPid} 2>/dev/null`],
      }).output();
      if (!probe.success) {
        stillAlive = false;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assertEquals(stillAlive, false);
  } finally {
    try {
      process.kill("SIGTERM");
    } catch { /* already stopped */ }
    try {
      await process.status;
    } catch { /* ignore */ }
    await Promise.allSettled([
      Deno.remove(homeDir, { recursive: true }),
      Deno.remove(stateDir, { recursive: true }),
      Deno.remove(binDir, { recursive: true }),
    ]);
  }
});
