import { assertEquals, assertStringIncludes } from "@std/assert";

// Helper to find a free TCP port
function getFreePort(): number {
  const listener = Deno.listen({ port: 0, hostname: "127.0.0.1" });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

// Server harness options
interface HarnessOptions {
  mockAgyScript?: string;
  agyToken?: string;
  agyReuse?: string;
  hardMarginMs?: string;
  printTimeout?: string;
}

// Spawns agy-bridge.ts under a hermetic temp environment with mock agy
class ServiceHarness {
  public port = 0;
  public stateDir = "";
  public mockBinDir = "";
  public homeDir = "";
  public process: Deno.ChildProcess | null = null;
  private aborted = false;

  static async create(opts: HarnessOptions = {}): Promise<ServiceHarness> {
    const harness = new ServiceHarness();
    harness.port = await getFreePort();
    harness.homeDir = await Deno.makeTempDir({ prefix: "agy_home_" });
    harness.stateDir = await Deno.makeTempDir({ prefix: "agy_state_" });
    harness.mockBinDir = await Deno.makeTempDir({ prefix: "agy_bin_" });

    // Create mock agy executable
    const mockAgyPath = `${harness.mockBinDir}/agy`;
    const defaultMockScript = `#!/usr/bin/env bash
# Default mock agy: responds to 'models' or user prompt
if [ "$1" = "models" ]; then
  printf "gemini-2.5-pro\\tGemini 2.5 Pro\\ngemini-2.5-flash\\tGemini 2.5 Flash\\n"
  exit 0
fi

# Read stdin NDJSON
read -r line
# Emit result
printf '{"event":"result","result":{"status":"SUCCESS","response":"mock completion text","conversation_id":"mock-conv-123","usage":{"input_tokens":10,"output_tokens":5}}}\\n'
exit 0
`;
    await Deno.writeTextFile(
      mockAgyPath,
      opts.mockAgyScript ?? defaultMockScript,
    );
    await Deno.chmod(mockAgyPath, 0o755);

    const env: Record<string, string> = {
      PORT: String(harness.port),
      HOSTNAME: "127.0.0.1",
      HOME: harness.homeDir,
      STATE_DIR: harness.stateDir,
      AGY_BIN: mockAgyPath,
      PATH: `${harness.mockBinDir}:${Deno.env.get("PATH") ?? ""}`,
      AGY_HARD_MARGIN_MS: opts.hardMarginMs ?? "60000",
      PRINT_TIMEOUT: opts.printTimeout ?? "15m",
      AGY_TOKEN: opts.agyToken ?? "",
      AGY_REUSE: opts.agyReuse ?? "off",
    };

    // Spawn deno run with scoped permissions matching agy-bridge invariants
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-net=127.0.0.1",
        `--allow-run=${mockAgyPath}`,
        `--allow-write=${harness.stateDir},${harness.homeDir}`,
        `--allow-read=${harness.stateDir},${harness.homeDir},${Deno.cwd()}`,
        "--allow-env",
        "agy-bridge.ts",
      ],
      cwd: Deno.cwd(),
      env,
      stdout: "piped",
      stderr: "piped",
    });

    harness.process = cmd.spawn();

    // Wait until server is healthy on /healthz
    const deadline = Date.now() + 10_000;
    let up = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${harness.port}/healthz`);
        if (res.ok) {
          up = true;
          break;
        }
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    if (!up) {
      await harness.close();
      throw new Error(`Server failed to start on port ${harness.port}`);
    }

    return harness;
  }

  async close(): Promise<void> {
    if (this.aborted) return;
    this.aborted = true;

    if (this.process) {
      try {
        this.process.kill("SIGTERM");
      } catch {
        // already stopped
      }
      try {
        await this.process.status;
      } catch {
        // ignore
      }
    }

    // Clean up temporary dirs
    try {
      await Deno.remove(this.homeDir, { recursive: true });
    } catch { /* ignore */ }
    try {
      await Deno.remove(this.stateDir, { recursive: true });
    } catch { /* ignore */ }
    try {
      await Deno.remove(this.mockBinDir, { recursive: true });
    } catch { /* ignore */ }
  }
}

// --------------------------------------------------------------------------
// Task 6.2: 403 host / 401 auth / healthz cases
// --------------------------------------------------------------------------

Deno.test("Task 6.2: /healthz and /v1/healthz are open and return { ok: true }", async () => {
  const harness = await ServiceHarness.create();
  try {
    const r1 = await fetch(`http://127.0.0.1:${harness.port}/healthz`);
    assertEquals(r1.status, 200);
    const j1 = await r1.json();
    assertEquals(j1, { ok: true });

    const r2 = await fetch(`http://127.0.0.1:${harness.port}/v1/healthz`);
    assertEquals(r2.status, 200);
    const j2 = await r2.json();
    assertEquals(j2, { ok: true });
  } finally {
    await harness.close();
  }
});

Deno.test("Task 6.2: 403 Forbidden on invalid Host header (DNS-rebind guard)", async () => {
  const harness = await ServiceHarness.create();
  try {
    // Send raw HTTP request because browser/fetch client overrides Host header to connection target
    const conn = await Deno.connect({
      hostname: "127.0.0.1",
      port: harness.port,
    });
    const rawReq = new TextEncoder().encode(
      "GET /v1/models HTTP/1.1\r\nHost: evil.com\r\nConnection: close\r\n\r\n",
    );
    await conn.write(rawReq);
    const buf = new Uint8Array(1024);
    const n = await conn.read(buf);
    conn.close();

    const resp = new TextDecoder().decode(buf.subarray(0, n ?? 0));
    assertStringIncludes(resp, "403 Forbidden");
    assertStringIncludes(resp, "forbidden host");
  } finally {
    await harness.close();
  }
});

Deno.test("Task 6.2: 401 Unauthorized when AGY_TOKEN set and missing/wrong Bearer", async () => {
  const harness = await ServiceHarness.create({ agyToken: "secret-token-123" });
  try {
    // Missing auth header
    const r1 = await fetch(`http://127.0.0.1:${harness.port}/v1/models`);
    assertEquals(r1.status, 401);
    const b1 = await r1.json();
    assertEquals(b1.error?.message, "unauthorized");

    // Invalid bearer token
    const r2 = await fetch(`http://127.0.0.1:${harness.port}/v1/models`, {
      headers: { Authorization: "Bearer wrong-token" },
    });
    assertEquals(r2.status, 401);

    // Correct bearer token
    const r3 = await fetch(`http://127.0.0.1:${harness.port}/v1/models`, {
      headers: { Authorization: "Bearer secret-token-123" },
    });
    assertEquals(r3.status, 200);
  } finally {
    await harness.close();
  }
});

// --------------------------------------------------------------------------
// Task 6.3: 400 routing, SSE + [DONE] + keepalive, deadline kill, salvage, retry
// --------------------------------------------------------------------------

Deno.test("Task 6.3: 400 routing errors for invalid JSON, missing model, and unknown model", async () => {
  const harness = await ServiceHarness.create();
  try {
    // 1. Invalid JSON body
    const r1 = await fetch(
      `http://127.0.0.1:${harness.port}/v1/chat/completions`,
      {
        method: "POST",
        body: "not json",
        headers: { "Content-Type": "application/json" },
      },
    );
    assertEquals(r1.status, 400);
    const b1 = await r1.json();
    assertEquals(b1.error?.message, "invalid JSON body");

    // 2. Missing model
    const r2 = await fetch(
      `http://127.0.0.1:${harness.port}/v1/chat/completions`,
      {
        method: "POST",
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
        headers: { "Content-Type": "application/json" },
      },
    );
    assertEquals(r2.status, 400);
    const b2 = await r2.json();
    assertEquals(b2.error?.message, "missing model");

    // 3. Unknown model
    const r3 = await fetch(
      `http://127.0.0.1:${harness.port}/v1/chat/completions`,
      {
        method: "POST",
        body: JSON.stringify({
          model: "nonexistent-model",
          messages: [{ role: "user", content: "hi" }],
        }),
        headers: { "Content-Type": "application/json" },
      },
    );
    assertEquals(r3.status, 400);
    const b3 = await r3.json();
    assertStringIncludes(b3.error?.message, "unknown model");
  } finally {
    await harness.close();
  }
});

// --------------------------------------------------------------------------
// issue-8-variant-carrier: handleChat body-key signal paths
// Spike obs #101: opencode 1.18.29 sends flat reasoning_effort on a /variant
// pick. Multi-effort base mock so auto-ro routes hit resolveWireModel.
// --------------------------------------------------------------------------

const multiEffortMockScript = `#!/usr/bin/env bash
if [ "$1" = "models" ]; then
  printf "gemini-3.7-flash-high\\tGemini 3.7 Flash High\\ngemini-3.7-flash-low\\tGemini 3.7 Flash Low\\ngemini-3.7-flash-medium\\tGemini 3.7 Flash Medium\\n"
  exit 0
fi

read -r line
printf '{"event":"result","result":{"status":"SUCCESS","response":"mock completion text","conversation_id":"mock-conv","usage":{"input_tokens":1,"output_tokens":1}}}\\n'
exit 0
`;

Deno.test("issue-8: flat reasoning_effort body key resolves to suffixed slug (200)", async () => {
  const harness = await ServiceHarness.create({
    mockAgyScript: multiEffortMockScript,
  });
  try {
    const res = await fetch(
      `http://127.0.0.1:${harness.port}/v1/chat/completions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "auto-ro-gemini-3.7-flash",
          reasoning_effort: "high",
          messages: [{ role: "user", content: "hi" }],
        }),
      },
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.choices[0].message.content, "mock completion text");
    // The resolved real slug the bridge actually ran must be the suffixed one.
    const usage = await Deno.readTextFile(`${harness.stateDir}/usage.jsonl`);
    assertStringIncludes(usage, "gemini-3.7-flash-high");
  } finally {
    await harness.close();
  }
});

Deno.test("issue-8: bare multi-effort base with NO accepted signal returns 400 naming suffixed slugs", async () => {
  const harness = await ServiceHarness.create({
    mockAgyScript: multiEffortMockScript,
  });
  try {
    const res = await fetch(
      `http://127.0.0.1:${harness.port}/v1/chat/completions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "auto-ro-gemini-3.7-flash",
          messages: [{ role: "user", content: "hi" }],
        }),
      },
    );
    assertEquals(res.status, 400);
    const body = await res.json();
    // Fail-closed: every declared suffixed slug is named, no silent default.
    assertStringIncludes(body.error?.message, "auto-ro-gemini-3.7-flash-high");
    assertStringIncludes(body.error?.message, "auto-ro-gemini-3.7-flash-low");
    assertStringIncludes(
      body.error?.message,
      "auto-ro-gemini-3.7-flash-medium",
    );
  } finally {
    await harness.close();
  }
});

Deno.test("Task 6.3: SSE streaming emits step deltas, [DONE], and chat.completion.chunk objects", async () => {
  const mockScript = `#!/usr/bin/env bash
if [ "$1" = "models" ]; then
  printf "gemini-2.5-pro\\tGemini 2.5 Pro\\n"
  exit 0
fi

read -r line
# Emit step updates
printf '{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"Hello"}}\\n'
printf '{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":" world"}}\\n'
printf '{"event":"result","result":{"status":"SUCCESS","response":"Hello world","conversation_id":"c1","usage":{"input_tokens":5,"output_tokens":2}}}\\n'
exit 0
`;
  const harness = await ServiceHarness.create({ mockAgyScript: mockScript });
  try {
    const res = await fetch(
      `http://127.0.0.1:${harness.port}/v1/chat/completions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-2.5-pro",
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        }),
      },
    );
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type"), "text/event-stream");

    const text = await res.text();
    assertStringIncludes(text, "data: [DONE]");
    assertStringIncludes(text, "chat.completion.chunk");
    assertStringIncludes(text, "Hello");
    assertStringIncludes(text, "world");
  } finally {
    await harness.close();
  }
});

Deno.test("Task 6.3: Deadline kill terminates hung agy process and returns 502", async () => {
  // Mock agy that hangs indefinitely ignoring SIGTERM
  const mockScript = `#!/usr/bin/env bash
if [ "$1" = "models" ]; then
  printf "gemini-2.5-pro\\tGemini 2.5 Pro\\n"
  exit 0
fi

trap '' TERM
while true; do
  sleep 1
done
`;
  // Set print timeout to 1s and hard margin to 100ms so deadline fires after ~1.1s
  const harness = await ServiceHarness.create({
    mockAgyScript: mockScript,
    printTimeout: "1s",
    hardMarginMs: "100",
  });

  try {
    const start = Date.now();
    const res = await fetch(
      `http://127.0.0.1:${harness.port}/v1/chat/completions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-2.5-pro",
          messages: [{ role: "user", content: "hang" }],
        }),
      },
    );
    const duration = Date.now() - start;

    assertEquals(res.status, 502);
    const body = await res.json();
    assertStringIncludes(body.error?.message, "agy hard deadline exceeded");
    // Should have timed out quickly, well under 8s
    assertEquals(duration < 8000, true);
  } finally {
    await harness.close();
  }
});

Deno.test("Task 6.3: Salvage recovers final response from transcript when agy exits with error", async () => {
  const convId = "salvage-test-conv";
  // Mock agy that exits with status ERROR but leaves transcript
  const mockScript = `#!/usr/bin/env bash
if [ "$1" = "models" ]; then
  printf "gemini-2.5-pro\\tGemini 2.5 Pro\\n"
  exit 0
fi

# Emit ERROR result with conversation_id
printf '{"event":"result","result":{"status":"ERROR","error":"trailing failure","conversation_id":"${convId}"}}\\n'
exit 1
`;
  const harness = await ServiceHarness.create({ mockAgyScript: mockScript });
  try {
    // Pre-create the transcript log file where salvageFinalResponse looks:
    // $HOME/.gemini/antigravity-cli/brain/${convId}/.system_generated/logs/transcript_full.jsonl
    const logDir =
      `${harness.homeDir}/.gemini/antigravity-cli/brain/${convId}/.system_generated/logs`;
    await Deno.mkdir(logDir, { recursive: true });
    const transcript = JSON.stringify({
      type: "PLANNER_RESPONSE",
      content: "Salvaged answer from planner transcript",
    }) + "\n";
    await Deno.writeTextFile(`${logDir}/transcript_full.jsonl`, transcript);

    const res = await fetch(
      `http://127.0.0.1:${harness.port}/v1/chat/completions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-2.5-pro",
          messages: [{ role: "user", content: "test salvage" }],
        }),
      },
    );

    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(
      body.choices[0].message.content,
      "Salvaged answer from planner transcript",
    );
  } finally {
    await harness.close();
  }
});

Deno.test("Task 6.3: Retry once as fresh conversation when continued session fails", async () => {
  // We enable AGY_REUSE=on
  // Turn 1 succeeds and establishes conversation 'conv-1'
  // Turn 2 receives --conversation conv-1 and fails with stale session
  // Server detects !r.ok && prepared.continued and retries without --conversation
  const mockScript = `#!/usr/bin/env bash
if [ "$1" = "models" ]; then
  printf "gemini-2.5-pro\\tGemini 2.5 Pro\\n"
  exit 0
fi

# Check if --conversation is present
has_conv=0
for arg in "$@"; do
  if [ "$arg" = "--conversation" ]; then
    has_conv=1
  fi
done

if [ "$has_conv" -eq 1 ]; then
  # Continued conversation fails
  printf '{"event":"result","result":{"status":"ERROR","error":"session expired"}}\\n'
  exit 1
else
  # Fresh conversation succeeds
  printf '{"event":"result","result":{"status":"SUCCESS","response":"retried fresh success","conversation_id":"fresh-conv-99","usage":{"input_tokens":5,"output_tokens":3}}}\\n'
  exit 0
fi
`;

  const harness = await ServiceHarness.create({
    mockAgyScript: mockScript,
    agyReuse: "on",
  });

  try {
    // Turn 1: creates convStore entry
    const r1 = await fetch(
      `http://127.0.0.1:${harness.port}/v1/chat/completions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-2.5-pro",
          messages: [{ role: "user", content: "turn 1" }],
        }),
      },
    );
    assertEquals(r1.status, 200);

    // Turn 2: continued conversation fails, retries fresh, succeeds
    const r2 = await fetch(
      `http://127.0.0.1:${harness.port}/v1/chat/completions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-2.5-pro",
          messages: [
            { role: "user", content: "turn 1" },
            { role: "assistant", content: "retried fresh success" },
            { role: "user", content: "turn 2" },
          ],
        }),
      },
    );
    assertEquals(r2.status, 200);
    const b2 = await r2.json();
    assertEquals(b2.choices[0].message.content, "retried fresh success");
  } finally {
    await harness.close();
  }
});

// --------------------------------------------------------------------------
// Task 6.4: Harness hermeticity — tmp paths only, kill child on abort
// --------------------------------------------------------------------------

Deno.test("Task 6.4: Harness is hermetic, writes usage log inside temp STATE_DIR, and terminates clean", async () => {
  const harness = await ServiceHarness.create();
  try {
    const res = await fetch(
      `http://127.0.0.1:${harness.port}/v1/chat/completions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-2.5-pro",
          messages: [{ role: "user", content: "log check" }],
        }),
      },
    );
    assertEquals(res.status, 200);

    // Assert usage.jsonl was written to the isolated temp STATE_DIR
    const usageFile = `${harness.stateDir}/usage.jsonl`;
    const usageContent = await Deno.readTextFile(usageFile);
    assertStringIncludes(usageContent, "gemini-2.5-pro");
  } finally {
    const home = harness.homeDir;
    const state = harness.stateDir;
    const bin = harness.mockBinDir;
    await harness.close();

    // Verify directories were removed on cleanup
    let homeExists = true;
    try {
      await Deno.stat(home);
    } catch {
      homeExists = false;
    }
    assertEquals(homeExists, false);

    let stateExists = true;
    try {
      await Deno.stat(state);
    } catch {
      stateExists = false;
    }
    assertEquals(stateExists, false);

    let binExists = true;
    try {
      await Deno.stat(bin);
    } catch {
      binExists = false;
    }
    assertEquals(binExists, false);
  }
});
