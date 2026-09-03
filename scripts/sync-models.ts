import {
  stripEffortSuffix,
  groupBases,
  buildModelMap,
  FALLBACK_MODELS,
} from "../plugins/agy-bridge-helpers.ts";

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
  runner?: (cmd: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
  fetcher?: (url: string) => Promise<Response>;
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
}

export interface SyncModelsResult {
  count: number;
  source: ResolutionSource;
  models: Record<string, unknown>;
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
    const token = safeEnvGet("AGY_TOKEN");
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    const resp = await fetcher(url);
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

/**
 * Synchronizes models from agy -> opencode.json using atomic read-modify-write.
 */
export async function syncModels(
  options: SyncModelsOptions = {},
): Promise<SyncModelsResult> {
  const resolution = await resolveSlugs(options);
  const bases = groupBases(resolution.slugs);
  const models = buildModelMap(bases);
  const count = Object.keys(models).length;

  if (options.dryRun) {
    if (options.printJson !== false) {
      console.log(JSON.stringify(models, null, 2));
    }
    return {
      count,
      source: resolution.source,
      models,
    };
  }

  const fs = options.fs || defaultFs;
  const configPath = options.configPath || getDefaultConfigPath();
  if (!configPath) {
    throw new Error("Cannot determine opencode.json config path");
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

  let existingConfig: Record<string, any> = {};
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

  if (
    !existingConfig.provider ||
    typeof existingConfig.provider !== "object" ||
    Array.isArray(existingConfig.provider)
  ) {
    existingConfig.provider = {};
  }

  if (
    !existingConfig.provider["agy-bridge"] ||
    typeof existingConfig.provider["agy-bridge"] !== "object" ||
    Array.isArray(existingConfig.provider["agy-bridge"])
  ) {
    existingConfig.provider["agy-bridge"] = {
      npm: "@ai-sdk/openai-compatible",
      options: {
        baseURL: "http://127.0.0.1:7421/v1",
      },
    };
  }

  // Update models key specifically
  existingConfig.provider["agy-bridge"].models = models;

  // Atomic write: write to tmp file then rename
  const tmpPath = `${configPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const serialized = JSON.stringify(existingConfig, null, 2) + "\n";
  await fs.writeTextFile(tmpPath, serialized);
  await fs.rename(tmpPath, configPath);

  return {
    count,
    source: resolution.source,
    models,
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
    } else if (arg === "-h" || arg === "--help") {
      console.log(`Usage: deno run [permissions] scripts/sync-models.ts [options]

Options:
  --dry-run             Print generated model map to stdout without writing
  --config-path <path>  Target opencode.json config file path
  --agy-bin <bin>       Path or name of agy binary (default: $AGY_BIN or 'agy')
  --bridge-url <url>    Bridge API URL (default: $AGY_BRIDGE_URL or 'http://127.0.0.1:7421')
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
    });
    if (!dryRun) {
      console.log(
        `[agy-bridge] Synchronized ${result.count} models from ${result.source} to ${result.configPath}`,
      );
    }
  } catch (err) {
    console.error(
      `[agy-bridge] Sync failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    Deno.exit(1);
  }
}
