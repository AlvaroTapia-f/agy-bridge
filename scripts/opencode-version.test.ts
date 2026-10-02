import { assertEquals } from "@std/assert";
import {
  type CommandRunner,
  describeDetection,
  detectOpenCodeTarget,
  normalizeTarget,
  parseOpenCodeVersion,
  sniffTargetFromConfig,
  targetFromMajor,
} from "./opencode-version.ts";

// --- parseOpenCodeVersion ----------------------------------------------------

Deno.test("parseOpenCodeVersion: parses the observed V2 shape 'opencode v2.0.20'", () => {
  assertEquals(parseOpenCodeVersion("opencode v2.0.20"), {
    major: 2,
    version: "2.0.20",
  });
});

Deno.test("parseOpenCodeVersion: parses a bare semver (observed V1 shape '1.18.29')", () => {
  assertEquals(parseOpenCodeVersion("1.18.29"), {
    major: 1,
    version: "1.18.29",
  });
});

Deno.test("parseOpenCodeVersion: tolerates prerelease suffixes and extra output lines", () => {
  assertEquals(parseOpenCodeVersion("opencode v2.1.0-beta.3")?.major, 2);
  assertEquals(
    parseOpenCodeVersion("some banner\nopencode v2.0.20\nupdate available")
      ?.major,
    2,
  );
});

Deno.test("parseOpenCodeVersion: unparseable input yields undefined, never a guess", () => {
  assertEquals(parseOpenCodeVersion(""), undefined);
  assertEquals(parseOpenCodeVersion("unknown-build"), undefined);
  assertEquals(parseOpenCodeVersion("opencode"), undefined);
  // Dates must not be read as versions.
  assertEquals(parseOpenCodeVersion("built 2026-09-30"), undefined);
  // Partial versions are not three-component semver.
  assertEquals(parseOpenCodeVersion("opencode v2"), undefined);
});

Deno.test("targetFromMajor: 1 -> v1, >=2 -> v2, anything else unknown", () => {
  assertEquals(targetFromMajor(1), "v1");
  assertEquals(targetFromMajor(2), "v2");
  assertEquals(targetFromMajor(3), "v2");
  assertEquals(targetFromMajor(0), undefined);
});

// --- normalizeTarget ---------------------------------------------------------

Deno.test("normalizeTarget: accepts v1/1/V1 and v2/2/V2, rejects junk", () => {
  assertEquals(normalizeTarget("v1"), "v1");
  assertEquals(normalizeTarget("1"), "v1");
  assertEquals(normalizeTarget("V1"), "v1");
  assertEquals(normalizeTarget(" v2 "), "v2");
  assertEquals(normalizeTarget("2"), "v2");
  assertEquals(normalizeTarget("v3"), undefined);
  assertEquals(normalizeTarget(""), undefined);
  assertEquals(normalizeTarget(undefined), undefined);
  assertEquals(normalizeTarget(2), undefined);
});

// --- sniffTargetFromConfig ---------------------------------------------------

Deno.test("sniffTargetFromConfig: native V2 keys win over legacy V1 keys", () => {
  assertEquals(sniffTargetFromConfig({ providers: {} }), "v2");
  assertEquals(sniffTargetFromConfig({ plugins: [] }), "v2");
  // A config mid-migration holding both shapes resolves to V2: native V2 takes
  // precedence regardless of key order (https://opencode.ai/v2/docs/migrate-v1).
  assertEquals(
    sniffTargetFromConfig({
      provider: {},
      providers: {},
      plugin: [],
      plugins: [],
    }),
    "v2",
  );
});

Deno.test("sniffTargetFromConfig: legacy V1 keys and empty configs", () => {
  assertEquals(sniffTargetFromConfig({ provider: {} }), "v1");
  assertEquals(sniffTargetFromConfig({ plugin: [] }), "v1");
  assertEquals(sniffTargetFromConfig({}), undefined);
  assertEquals(sniffTargetFromConfig({ providers: [] }), undefined);
  assertEquals(sniffTargetFromConfig(null), undefined);
  assertEquals(sniffTargetFromConfig("providers"), undefined);
});

// --- detectOpenCodeTarget ----------------------------------------------------

function runnerReturning(
  stdout: string,
  code = 0,
): CommandRunner {
  return () => Promise.resolve({ code, stdout, stderr: "" });
}

Deno.test("detect: explicit target short-circuits every other signal", async () => {
  const result = await detectOpenCodeTarget({
    target: "v2",
    env: () => "v1",
    runner: runnerReturning("opencode v1.18.29"),
    configPath: "/tmp/opencode.json",
    readTextFile: () => Promise.resolve('{"provider":{}}'),
  });
  assertEquals(result, { target: "v2", source: "env" });
});

Deno.test("detect: AGY_OPENCODE_TARGET env is honoured before probing the CLI", async () => {
  const result = await detectOpenCodeTarget({
    env: (key) => (key === "AGY_OPENCODE_TARGET" ? "v2" : undefined),
    runner: runnerReturning("opencode v1.18.29"),
  });
  assertEquals(result.target, "v2");
  assertEquals(result.source, "env");
});

Deno.test("detect: opencode --version major picks the branch", async () => {
  const v2 = await detectOpenCodeTarget({
    env: () => undefined,
    runner: runnerReturning("opencode v2.0.20"),
  });
  assertEquals(v2.target, "v2");
  assertEquals(v2.source, "cli");
  assertEquals(v2.major, 2);
  assertEquals(v2.version, "2.0.20");

  const v1 = await detectOpenCodeTarget({
    env: () => undefined,
    runner: runnerReturning("opencode 1.18.29"),
  });
  assertEquals(v1.target, "v1");
  assertEquals(v1.source, "cli");
});

Deno.test("detect: the CLI is asked for --version by default", async () => {
  const seen: Array<{ cmd: string; args: string[] }> = [];
  await detectOpenCodeTarget({
    env: () => undefined,
    runner: (cmd, args) => {
      seen.push({ cmd, args });
      return Promise.resolve({
        code: 0,
        stdout: "opencode v2.0.20",
        stderr: "",
      });
    },
  });
  assertEquals(seen, [{ cmd: "opencode", args: ["--version"] }]);
});

Deno.test("detect: OPENCODE_BIN overrides the probed binary name", async () => {
  const seen: Array<{ cmd: string; args: string[] }> = [];
  await detectOpenCodeTarget({
    env: (key) => (key === "OPENCODE_BIN" ? "/opt/oc/opencode" : undefined),
    runner: (cmd, args) => {
      seen.push({ cmd, args });
      return Promise.resolve({
        code: 0,
        stdout: "opencode v2.0.20",
        stderr: "",
      });
    },
  });
  assertEquals(seen[0].cmd, "/opt/oc/opencode");
});

Deno.test("detect: a throwing runner (opencode absent) falls through to config", async () => {
  const result = await detectOpenCodeTarget({
    env: () => undefined,
    runner: () => Promise.reject(new Error("No such file or directory")),
    configPath: "/tmp/opencode.json",
    readTextFile: () => Promise.resolve('{"providers":{}}'),
  });
  assertEquals(result, { target: "v2", source: "config" });
});

Deno.test("detect: non-zero exit and unparseable output both fall through to config", async () => {
  for (
    const runner of [
      runnerReturning("opencode v2.0.20", 1),
      runnerReturning("unknown-build"),
      runnerReturning(""),
    ]
  ) {
    const result = await detectOpenCodeTarget({
      env: () => undefined,
      runner,
      configPath: "/tmp/opencode.json",
      readTextFile: () => Promise.resolve('{"plugin":[]}'),
    });
    assertEquals(result, { target: "v1", source: "config" });
  }
});

Deno.test("detect: a missing or corrupt config falls back to the v1 default", async () => {
  const missing = await detectOpenCodeTarget({
    env: () => undefined,
    configPath: "/tmp/opencode.json",
    readTextFile: () =>
      Promise.reject(new Error("NotFound: /tmp/opencode.json")),
  });
  assertEquals(missing, { target: "v1", source: "default" });

  const corrupt = await detectOpenCodeTarget({
    env: () => undefined,
    configPath: "/tmp/opencode.json",
    readTextFile: () => Promise.resolve("{not json"),
  });
  assertEquals(corrupt, { target: "v1", source: "default" });
});

Deno.test("detect: an empty config with no signals defaults to v1", async () => {
  const result = await detectOpenCodeTarget({
    env: () => undefined,
    configPath: "/tmp/opencode.json",
    readTextFile: () => Promise.resolve("{}"),
  });
  assertEquals(result, { target: "v1", source: "default" });
});

Deno.test("detect: no runner and no configPath means default v1", async () => {
  const result = await detectOpenCodeTarget({ env: () => undefined });
  assertEquals(result, { target: "v1", source: "default" });
});

Deno.test("describeDetection: mentions the target and its source", () => {
  assertEquals(
    describeDetection({
      target: "v2",
      source: "cli",
      major: 2,
      version: "2.0.20",
    }),
    "opencode config target: v2 (via cli, version 2.0.20)",
  );
  assertEquals(
    describeDetection({ target: "v1", source: "default" }),
    "opencode config target: v1 (via default)",
  );
});
