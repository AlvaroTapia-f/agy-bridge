import {
  groupBases,
  buildModelMap,
  FALLBACK_MODELS,
  MODEL_MAP_VERSION,
} from "../plugins/agy-bridge-helpers.ts";
import {
  BRIDGE_BASE_URL,
  type CommandRunner,
  type OpenCodeTarget,
  type VersionDetection,
  describeDetection,
  normalizeTarget,
  V2_PACKAGE,
  detectOpenCodeTarget,
} from "./opencode-version.ts";

/**
 * Parses `agy models` TSV output into a list of model slug strings.
 * Filters empty lines, headers, and extracts the first column.
 */
export function parseTsv(stdout: string): string[] {
  if (!stdout || !stdout.trim()) return [];
  const lines = stdout.split("\n");
  const slugs: string[] = [];

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;
    const tabIndex = rawLine.indexOf("\t");
    const col0 = (tabIndex === -1 ? rawLine : rawLine.slice(0, tabIndex)).trim();
    if (!col0) continue;
    const lower = col0.toLowerCase();
    if (lower === "id" || lower === "model" || lower === "slug" || lower === "name") {
      continue;
    }
    slugs.push(col0);
  }

  return slugs;
}

export type ResolutionSource = "tsv" | "api" | "fallback";

export interface ResolveSlugsResult {
  slugs: string[];
  source: ResolutionSource;
}

export interface ResolveSlugsOptions {
  agyBin?: string;
  bridgeUrl?: string;
  token?: string;
  runner?: (cmd: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface SyncFs {
  readTextFile: (path: string) => Promise<string>;
  writeTextFile: (path: string, data: string) => Promise<void>;
  rename: (oldPath: string, newPath: string) => Promise<void>;
  mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  stat?: (path: string) => Promise<unknown>;
}

const defaultFs: SyncFs = {
  readTextFile: (p) => Deno.readTextFile(p),
  writeTextFile: (p, d) => Deno.writeTextFile(p, d),
  rename: (o, n) => Deno.rename(o, n),
  mkdir: (p, opt) => Deno.mkdir(p, opt),
  stat: (p) => Deno.stat(p),
};

export interface SyncModelsOptions extends ResolveSlugsOptions {
  configPath?: string;
  dryRun?: boolean;
  printJson?: boolean;
  fs?: SyncFs;
  /**
   * Explicit OpenCode major version. When omitted the target is detected via
   * `detectOpenCodeTarget` (`AGY_OPENCODE_TARGET` > `opencode --version` >
   * existing-config shape > `v1` default).
   */
  target?: OpenCodeTarget;
  /** Spawns `opencode --version` during detection. Omit to skip that step. */
  versionRunner?: CommandRunner | null;
  opencodeBin?: string;
  /**
   * V1 plugin path to strip from `plugin[]` when converting to V2. Left empty
   * by default so a standalone `deno task sync:models` never guesses a path.
   */
  v1PluginPath?: string;
}

export interface SyncModelsResult {
  /** Models actually persisted into the config file (0 on V2 — see below). */
  count: number;
  /** Models resolved from the live catalog, regardless of what was persisted. */
  resolved: number;
  source: ResolutionSource;
  models: Record<string, unknown>;
  modelMapVersion: number;
  target: OpenCodeTarget;
  detection: VersionDetection;
  configPath?: string;
}

/** Default subprocess runner with 10s timeout */
async function defaultRunner(
  cmd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const command = new Deno.Command(cmd, {
    args,
    stdout: "piped",
    stderr: "piped",
  });
  const child = command.spawn();

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      reject(new Error(`Command '${cmd} ${args.join(" ")}' timed out after 10000ms`));
    }, 10000);
  });

  const outputPromise = (async () => {
    const output = await child.output();
    const decoder = new TextDecoder();
    return {
      code: output.code,
      stdout: decoder.decode(output.stdout),
      stderr: decoder.decode(output.stderr),
    };
  })();

  return await Promise.race([outputPromise, timeoutPromise]);
}

function safeEnvGet(key: string): string | undefined {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
}

/**
 * Resolves available model slugs using a three-tier fallback chain:
 * 1. `agy models` TSV subprocess
 * 2. Bridge API `GET /v1/models`
 * 3. Hardcoded `FALLBACK_MODELS`
 */
export async function resolveSlugs(
  options: ResolveSlugsOptions = {},
): Promise<ResolveSlugsResult> {
  const agyBin = options.agyBin || safeEnvGet("AGY_BIN") || "agy";
  const bridgeUrl = options.bridgeUrl || safeEnvGet("AGY_BRIDGE_URL") || "http://127.0.0.1:7421";
  const runner = options.runner || defaultRunner;
  const fetcher = options.fetcher || globalThis.fetch;

  // Tier 1: agy models TSV
  try {
    const result = await runner(agyBin, ["models"]);
    if (result.code === 0 && result.stdout) {
      const parsed = parseTsv(result.stdout);
      if (parsed.length > 0) {
        return { slugs: parsed, source: "tsv" };
      }
    }
  } catch (_err) {
    // Suppress sensitive details, proceed to Tier 2
  }

  // Tier 2: Bridge API GET /v1/models
  try {
    const url = `${bridgeUrl.replace(/\/+$/, "")}/v1/models`;
    const token = options.token !== undefined ? options.token : safeEnvGet("AGY_TOKEN");
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    const init: RequestInit = Object.keys(headers).length > 0 ? { headers } : {};
    const resp = await fetcher(url, init);
    if (resp.ok) {
      const data = (await resp.json()) as { data?: Array<{ id?: string }> };
      if (data && Array.isArray(data.data)) {
        const ids = data.data
          .map((m) => (typeof m.id === "string" ? m.id.trim() : ""))
          .filter(Boolean);
        if (ids.length > 0) {
          return { slugs: ids, source: "api" };
        }
      }
    }
  } catch (_err) {
    // Proceed to Tier 3
  }

  // Tier 3: FALLBACK_MODELS
  return { slugs: [...FALLBACK_MODELS], source: "fallback" };
}

/** Resolves default opencode.json path */
export function getDefaultConfigPath(): string {
  const xdg = safeEnvGet("XDG_CONFIG_HOME");
  if (xdg) {
    return `${xdg}/opencode/opencode.json`;
  }
  const home = safeEnvGet("HOME") || "";
  return `${home}/.config/opencode/opencode.json`;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Removes our own legacy V1 entries from a config being converted to the native
 * V2 shape.
 *
 * Two stale keys are actively harmful in V2 and are safe to drop because we own
 * the `agy-bridge` provider id and our plugin path:
 *
 * - `provider["agy-bridge"]`: V1 kept working in V2, but its `models` carry the
 *   V1 fields `reasoning` and boolean `interleaved`, which V2 explicitly lists
 *   as "accepted but unsupported" and ignores *with a warning*
 *   (https://opencode.ai/v2/docs/migrate-v1). Leaving it also duplicates the
 *   source of truth for the catalog.
 * - `plugin` entries pointing at the V1 plugin file: V1 plugin implementations
 *   do not run in V2, so a stale reference loads a file that cannot register.
 *
 * Only entries that match agy-bridge are removed; every other provider and
 * plugin entry is preserved untouched.
 */
export function pruneLegacyV1Entries(
  config: Record<string, unknown>,
  v1PluginPath: string,
): void {
  if (isPlainObject(config.provider) && "agy-bridge" in config.provider) {
    const providers = { ...config.provider };
    delete providers["agy-bridge"];
    config.provider = providers;
  }
  if (Array.isArray(config.plugin)) {
    const kept = config.plugin.filter((entry) =>
      typeof entry === "string" ? entry !== v1PluginPath : true
    );
    if (kept.length === config.plugin.length) return;
    if (kept.length === 0) {
      delete config.plugin;
    } else {
      config.plugin = kept;
    }
  }
}

/**
 * Writes the agy-bridge provider block in the shape for `target`.
 *
 * V1 (`provider` / `npm` / `options.baseURL`): the static `models` map is the
 * source of truth, because the V1 plugin's `provider.models` hook is not what
 * drives `/models` reliably across V1 patch versions.
 *
 * V2 (`providers` / `package` / `settings.baseURL`): the static `models` map is
 * deliberately NOT written. The V2 plugin registers the provider AND its
 * catalog through `ctx.provider.transform` -> `editor.add({info, models})`
 * (https://opencode.ai/v2/docs/build/plugins), and config `providers.<id>.models`
 * is documented as "models to add or override" — i.e. a second, frozen copy of a
 * catalog the plugin already refreshes on `ctx.provider.reload()`. Writing it
 * would duplicate the source of truth and, since `buildModelMap` emits V1 shape,
 * make V2 warn on every model about `reasoning`/`interleaved`. See
 * docs/model-contract.md.
 */
export function buildProviderEntry(
  target: OpenCodeTarget,
  existing: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const prior = isPlainObject(existing) ? existing : {};
  if (target === "v1") {
    const options = isPlainObject(prior.options) ? { ...prior.options } : {};
    return {
      ...prior,
      npm: "@ai-sdk/openai-compatible",
      name: prior.name ?? "AGY Bridge",
      options: { ...options, baseURL: BRIDGE_BASE_URL },
    };
  }
  const settings = isPlainObject(prior.settings) ? { ...prior.settings } : {};
  return {
    ...prior,
    name: prior.name ?? "AGY Bridge",
    package: V2_PACKAGE,
    settings: { ...settings, baseURL: BRIDGE_BASE_URL },
  };
}

/**
 * Synchronizes models from agy -> opencode.json using atomic read-modify-write.
 */
export async function syncModels(
  options: SyncModelsOptions = {},
): Promise<SyncModelsResult> {
  const fs = options.fs || defaultFs;
  const configPath = options.configPath || getDefaultConfigPath();
  if (!configPath) {
    throw new Error("Cannot determine opencode.json config path");
  }

  // Resolve the target before resolving slugs: on V2 the catalog is the
  // plugin's job, so an unreachable bridge must not fail the installer.
  const detection = await detectOpenCodeTarget({
    target: options.target,
    runner: options.versionRunner,
    opencodeBin: options.opencodeBin,
    readTextFile: options.fs ? (path) => options.fs!.readTextFile(path) : undefined,
    configPath: options.configPath,
  });
  const target = detection.target;

  const resolution = await resolveSlugs(options);
  const bases = groupBases(resolution.slugs);
  const models = buildModelMap(bases);
  const resolved = Object.keys(models).length;
  const count = target === "v1" ? resolved : 0;

  if (options.dryRun) {
    if (options.printJson !== false) {
      console.log(JSON.stringify(models, null, 2));
    }
    return {
      count,
      resolved,
      source: resolution.source,
      models,
      modelMapVersion: MODEL_MAP_VERSION,
      target,
      detection,
    };
  }

  // Ensure directory exists
  const lastSlash = configPath.lastIndexOf("/");
  if (lastSlash > 0) {
    const parentDir = configPath.substring(0, lastSlash);
    try {
      await fs.mkdir(parentDir, { recursive: true });
    } catch {
      // ignore if already exists
    }
  }

  let existingConfig: Record<string, unknown> = {};
  let fileExisted = false;

  try {
    const raw = await fs.readTextFile(configPath);
    fileExisted = true;
    // Create .bak backup before modifying existing file
    await fs.writeTextFile(`${configPath}.bak`, raw);
    existingConfig = JSON.parse(raw);
  } catch (err) {
    if (
      err instanceof Deno.errors?.NotFound ||
      (err instanceof Error && err.message.includes("NotFound"))
    ) {
      fileExisted = false;
    } else if (fileExisted) {
      // Existing file had invalid JSON syntax; keep backup and reset
      existingConfig = {};
    }
  }

  if (
    typeof existingConfig !== "object" ||
    existingConfig === null ||
    Array.isArray(existingConfig)
  ) {
    existingConfig = {};
  }

  if (target === "v2") {
    // Native V2 shape. Prune our own V1 leftovers first so the config holds a
    // single source of truth per key (see pruneLegacyV1Entries).
    pruneLegacyV1Entries(existingConfig, options.v1PluginPath ?? "");
    const providers = isPlainObject(existingConfig.providers)
      ? existingConfig.providers
      : {};
    providers["agy-bridge"] = buildProviderEntry(
      target,
      providers["agy-bridge"] as Record<string, unknown> | undefined,
    );
    existingConfig.providers = providers;
  } else {
    const providers = (
      existingConfig.provider &&
      typeof existingConfig.provider === "object" &&
      !Array.isArray(existingConfig.provider)
    ) ? existingConfig.provider as Record<string, Record<string, unknown>> : {};
    existingConfig.provider = providers;

    const agyBridgeConfig = buildProviderEntry(
      target,
      providers["agy-bridge"] as Record<string, unknown> | undefined,
    );
    providers["agy-bridge"] = agyBridgeConfig;

    // Update models key specifically (V1 keeps the static map as source of truth)
    agyBridgeConfig.models = models;
  }

  // Atomic write: write to tmp file then rename
  const tmpPath = `${configPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const serialized = JSON.stringify(existingConfig, null, 2) + "\n";
  await fs.writeTextFile(tmpPath, serialized);
  await fs.rename(tmpPath, configPath);

  return {
    count,
    resolved,
    source: resolution.source,
    models,
    modelMapVersion: MODEL_MAP_VERSION,
    target,
    detection,
    configPath,
  };
}

// CLI entrypoint
if (import.meta.main) {
  const args = Deno.args;
  let dryRun = false;
  let configPath: string | undefined;
  let agyBin: string | undefined;
  let bridgeUrl: string | undefined;
  let target: OpenCodeTarget | undefined;
  let v1PluginPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--config-path" && i + 1 < args.length) {
      configPath = args[++i];
    } else if (arg.startsWith("--config-path=")) {
      configPath = arg.slice("--config-path=".length);
    } else if (arg === "--agy-bin" && i + 1 < args.length) {
      agyBin = args[++i];
    } else if (arg.startsWith("--agy-bin=")) {
      agyBin = arg.slice("--agy-bin=".length);
    } else if (arg === "--bridge-url" && i + 1 < args.length) {
      bridgeUrl = args[++i];
    } else if (arg.startsWith("--bridge-url=")) {
      bridgeUrl = arg.slice("--bridge-url=".length);
    } else if (arg === "--target" && i + 1 < args.length) {
      const parsed = normalizeTarget(args[++i]);
      if (!parsed) {
        console.error(`[agy-bridge] Invalid --target '${args[i]}' (expected v1 or v2)`);
        Deno.exit(1);
      }
      target = parsed;
    } else if (arg.startsWith("--target=")) {
      const parsed = normalizeTarget(arg.slice("--target=".length));
      if (!parsed) {
        console.error(`[agy-bridge] Invalid --target in '${arg}' (expected v1 or v2)`);
        Deno.exit(1);
      }
      target = parsed;
    } else if (arg === "--v1-plugin-path" && i + 1 < args.length) {
      v1PluginPath = args[++i];
    } else if (arg.startsWith("--v1-plugin-path=")) {
      v1PluginPath = arg.slice("--v1-plugin-path=".length);
    } else if (arg === "-h" || arg === "--help") {
      console.log(`Usage: deno run [permissions] scripts/sync-models.ts [options]

Options:
  --dry-run             Print generated model map to stdout without writing
  --config-path <path>  Target opencode.json config file path
  --agy-bin <bin>       Path or name of agy binary (default: $AGY_BIN or 'agy')
  --bridge-url <url>    Bridge API URL (default: $AGY_BRIDGE_URL or 'http://127.0.0.1:7421')
  --target <v1|v2>      Force the OpenCode config shape (default: auto-detect)
  --v1-plugin-path <p>  V1 plugin path to drop from plugin[] when targeting v2
  -h, --help            Show this help message
`);
      Deno.exit(0);
    }
  }

  try {
    const result = await syncModels({
      dryRun,
      configPath,
      agyBin,
      bridgeUrl,
      target,
      v1PluginPath,
      versionRunner: target ? null : defaultRunner,
    });
    if (!dryRun) {
      if (result.target === "v2") {
        console.log(
          `[agy-bridge] Registered providers.agy-bridge (${V2_PACKAGE}) to ${result.configPath} — catalog is published at runtime by the V2 plugin (${result.resolved} models resolved from ${result.source}, not written to config)`,
        );
      } else {
        console.log(
          `[agy-bridge] Synchronized ${result.count} models from ${result.source} to ${result.configPath} (model map v${result.modelMapVersion})`,
        );
      }
      console.log(`[agy-bridge] ${describeDetection(result.detection)}`);
    }
  } catch (err) {
    console.error(
      `[agy-bridge] Sync failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    Deno.exit(1);
  }
}
