/**
 * Shared OpenCode major-version detection.
 *
 * Single source of truth for "which config shape do we write?" used by both
 * `scripts/sync-models.ts` (TypeScript, runs standalone via
 * `deno task sync:models`) and `install.sh` (bash, which already hard-requires
 * `deno`, so it shells out to this module's CLI instead of re-implementing the
 * parse). Keeping one implementation avoids the two callers disagreeing about
 * the same machine.
 *
 * Detection order (first hit wins):
 *   1. explicit override — `AGY_OPENCODE_TARGET` env or `options.target`
 *   2. `opencode --version` major version
 *   3. shape of the existing opencode.json (`providers`/`plugins` vs
 *      `provider`/`plugin`)
 *   4. default: `v1`
 *
 * Why the default is `v1` rather than "whatever": the native V2 config shape is
 * NOT accepted by a V1 runtime, while V1 syntax keeps working in V2 —
 * https://opencode.ai/v2/docs/migrate-v1 ("It normalizes supported V1 and native
 * V2 fields in memory without rewriting the source file"). So the conservative
 * write is the V1 shape.
 */

export type OpenCodeTarget = "v1" | "v2";

export type DetectionSource = "env" | "cli" | "config" | "default";

export interface VersionDetection {
  target: OpenCodeTarget;
  source: DetectionSource;
  /** Major version parsed from `opencode --version`, when the CLI answered. */
  major?: number;
  /** First version-looking token found in the CLI output, for logs. */
  version?: string;
}

export interface ParsedVersion {
  major: number;
  version: string;
}

/** Package that OpenCode V2 uses for OpenAI-compatible endpoints. */
export const V2_PACKAGE = "@opencode/ai/providers/openai-compatible";

/** Bridge endpoint shared by both config shapes. */
export const BRIDGE_BASE_URL = "http://127.0.0.1:7421/v1";

/** Env override read by both callers. */
export const TARGET_ENV_VAR = "AGY_OPENCODE_TARGET";

const VERSION_PATTERN = /(?<![\w.])v?(\d+)\.(\d+)\.(\d+)(?![\d.])/;

/**
 * Extracts the first `vMAJOR.MINOR.PATCH` token from `opencode --version`
 * output. Observed real shapes: `opencode v2.0.20` (V2) and bare
 * `1.18.29` (V1). Anything without a three-component version is unparseable,
 * which the caller treats as "unknown", never as a guess.
 */
export function parseOpenCodeVersion(
  output: string,
): ParsedVersion | undefined {
  if (!output) return undefined;
  for (const line of output.split("\n")) {
    const match = VERSION_PATTERN.exec(line);
    if (match) {
      return {
        major: Number(match[1]),
        version: `${match[1]}.${match[2]}.${match[3]}`,
      };
    }
  }
  return undefined;
}

/** Maps a parsed version to a config target. Major 0/3+ is not a known shape. */
export function targetFromMajor(major: number): OpenCodeTarget | undefined {
  if (major >= 2) return "v2";
  if (major === 1) return "v1";
  return undefined;
}

/**
 * Normalizes an override value. Accepts `1`/`v1`/`V1` and `2`/`v2`/`V2`;
 * anything else is rejected so a typo falls through to real detection instead
 * of silently writing the wrong shape.
 */
export function normalizeTarget(value: unknown): OpenCodeTarget | undefined {
  if (typeof value !== "string") return undefined;
  const token = value.trim().toLowerCase().replace(/^v/, "");
  if (token === "1") return "v1";
  if (token === "2") return "v2";
  return undefined;
}

/**
 * Infers the target from the shape of an existing opencode.json. Native V2 keys
 * win over legacy V1 keys because they take precedence when both are present
 * (https://opencode.ai/v2/docs/migrate-v1: "a valid native V2 value takes
 * precedence regardless of JSON key order").
 */
export function sniffTargetFromConfig(
  config: unknown,
): OpenCodeTarget | undefined {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    return undefined;
  }
  const record = config as Record<string, unknown>;
  const isMap = (v: unknown): boolean =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  if (isMap(record.providers)) return "v2";
  if (Array.isArray(record.plugins)) return "v2";
  if (isMap(record.provider)) return "v1";
  if (Array.isArray(record.plugin)) return "v1";
  return undefined;
}

export type CommandRunner = (
  cmd: string,
  args: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface DetectOptions {
  /** Explicit override; wins over everything except the env var. */
  target?: unknown;
  /** Env getter, injectable for tests. */
  env?: (key: string) => string | undefined;
  /** Spawns `opencode --version`. Omit to skip CLI detection entirely. */
  runner?: CommandRunner | null;
  opencodeBin?: string;
  /** Reads the existing config for shape sniffing. Omit to skip that step. */
  readTextFile?: (path: string) => Promise<string>;
  configPath?: string;
}

function safeEnvGet(key: string): string | undefined {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
}

/**
 * Runs the whole cascade and returns the first confident answer.
 *
 * Every step is allowed to fail silently: a missing `opencode` binary, an
 * unparseable version string, a missing or invalid config file. Only an
 * explicit, valid override short-circuits the cascade; the `default` fallback
 * keeps V1 behavior byte-identical to the pre-V2 installer.
 */
export async function detectOpenCodeTarget(
  options: DetectOptions = {},
): Promise<VersionDetection> {
  const explicit = normalizeTarget(options.target);
  if (explicit) return { target: explicit, source: "env" };

  const env = options.env ?? safeEnvGet;
  const fromEnv = normalizeTarget(env(TARGET_ENV_VAR));
  if (fromEnv) return { target: fromEnv, source: "env" };

  const runner = options.runner;
  if (runner) {
    const bin = options.opencodeBin || env("OPENCODE_BIN") || "opencode";
    try {
      const result = await runner(bin, ["--version"]);
      if (result.code === 0) {
        const parsed = parseOpenCodeVersion(
          `${result.stdout}\n${result.stderr}`,
        );
        const target = parsed ? targetFromMajor(parsed.major) : undefined;
        if (parsed && target) {
          return {
            target,
            source: "cli",
            major: parsed.major,
            version: parsed.version,
          };
        }
      }
    } catch {
      // Binary missing or not executable — fall through to config sniffing.
    }
  }

  if (options.readTextFile && options.configPath) {
    try {
      const raw = await options.readTextFile(options.configPath);
      const sniffed = sniffTargetFromConfig(JSON.parse(raw));
      if (sniffed) return { target: sniffed, source: "config" };
    } catch {
      // Missing or invalid config — fall through to the default.
    }
  }

  return { target: "v1", source: "default" };
}

/** One-line human summary for installer logs. */
export function describeDetection(detection: VersionDetection): string {
  const bits = [
    `opencode config target: ${detection.target} (via ${detection.source}`,
  ];
  if (detection.version) bits.push(`, version ${detection.version}`);
  bits.push(")");
  return bits.join("");
}

if (import.meta.main) {
  const args = Deno.args;
  let configPath: string | undefined;
  let targetOverride: string | undefined;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--config-path" && i + 1 < args.length) {
      configPath = args[++i];
    } else if (arg.startsWith("--config-path=")) {
      configPath = arg.slice("--config-path=".length);
    } else if (arg === "--target" && i + 1 < args.length) {
      targetOverride = args[++i];
    } else if (arg.startsWith("--target=")) {
      targetOverride = arg.slice("--target=".length);
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "-h" || arg === "--help") {
      console.log(
        `Usage: deno run [permissions] scripts/opencode-version.ts [options]

Options:
  --config-path <path>  Existing opencode.json to sniff when --version is unusable
  --target <v1|v2>      Force a target instead of detecting
  --json                Print the full detection result as JSON
  -h, --help            Show this help message
`,
      );
      Deno.exit(0);
    }
  }

  const detection = await detectOpenCodeTarget({
    target: targetOverride,
    opencodeBin: safeEnvGet("OPENCODE_BIN") || undefined,
    runner: async (cmd, cmdArgs) => {
      const command = new Deno.Command(cmd, {
        args: cmdArgs,
        stdout: "piped",
        stderr: "piped",
      });
      const output = await command.output();
      return {
        code: output.code,
        stdout: new TextDecoder().decode(output.stdout),
        stderr: new TextDecoder().decode(output.stderr),
      };
    },
    readTextFile: (path) => Deno.readTextFile(path),
    configPath,
  });

  if (json) {
    console.log(JSON.stringify(detection));
  } else {
    console.log(detection.target);
  }
}
