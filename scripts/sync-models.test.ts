import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  stripEffortSuffix,
  groupBases,
  buildModelMap,
  FALLBACK_MODELS,
  EFFORT_SUFFIXES,
} from "../plugins/agy-bridge-helpers.ts";
import {
  parseTsv,
  resolveSlugs,
  syncModels,
  getDefaultConfigPath,
} from "./sync-models.ts";

// --- parseTsv Tests (Tasks 2.1 & 4.1) ---

Deno.test("parseTsv: extracts first column from standard TSV", () => {
  const tsv = `id\tname\tdescription
gemini-3.7-flash-high\tGemini 3.7 Flash High\tFast model with high effort
claude-sonnet-4-6\tClaude Sonnet 4.6\tGeneral model
gpt-oss-120b-medium\tGPT OSS 120b Medium\tOSS model
`;
  const slugs = parseTsv(tsv);
  assertEquals(slugs, [
    "gemini-3.7-flash-high",
    "claude-sonnet-4-6",
    "gpt-oss-120b-medium",
  ]);
});

Deno.test("parseTsv: ignores empty lines, blank lines, and whitespace", () => {
  const tsv = `
gemini-3.7-flash-high\tGemini 3.7 Flash High

  \t  
claude-sonnet-4-6\tClaude Sonnet 4.6
   
`;
  const slugs = parseTsv(tsv);
  assertEquals(slugs, ["gemini-3.7-flash-high", "claude-sonnet-4-6"]);
});

Deno.test("parseTsv: handles single-column lines without tabs", () => {
  const tsv = `gemini-3.7-flash-high\nclaude-opus-4-6-thinking\n`;
  const slugs = parseTsv(tsv);
  assertEquals(slugs, ["gemini-3.7-flash-high", "claude-opus-4-6-thinking"]);
});

Deno.test("parseTsv: returns empty array for empty or header-only string", () => {
  assertEquals(parseTsv(""), []);
  assertEquals(parseTsv("   \n\n  "), []);
  assertEquals(parseTsv("id\tname\tdescription\n"), []);
  assertEquals(parseTsv("MODEL\tNAME\n"), []);
});

Deno.test("parseTsv: filters out rows with empty first column", () => {
  const tsv = `\tName without id\ngemini-3.7-flash-low\tGemini Flash Low\n`;
  const slugs = parseTsv(tsv);
  assertEquals(slugs, ["gemini-3.7-flash-low"]);
});

// --- Dynamic Effort & Grouping Tests (Tasks 1.1 & 4.2) ---

Deno.test("dynamic effort: gemini-3.8-flash-ultra is grouped under gemini-3.8-flash with ultra variant", () => {
  const slugs = ["gemini-3.8-flash-high", "gemini-3.8-flash-ultra"];
  const grouped = groupBases(slugs);
  const flash38 = grouped.get("gemini-3.8-flash");
  assertExists(flash38);
  assertEquals(flash38.has("high"), true);
  assertEquals(flash38.has("ultra"), true);

  const map = buildModelMap(grouped);
  const ro = map["auto-ro-gemini-3.8-flash"] as {
    reasoning?: boolean;
    interleaved?: { field: string };
    capabilities?: unknown;
    variants: Record<string, { reasoningEffort: string }>;
  };
  assertExists(ro);
  assertEquals(ro.reasoning, true);
  assertEquals(ro.interleaved, { field: "reasoning_content" });
  assertEquals(ro.capabilities, undefined);
  assertEquals(ro.variants.ultra.reasoningEffort, "ultra");
  assertEquals(ro.variants.high.reasoningEffort, "high");
});

Deno.test("dynamic effort: multi-variant base with unknown suffixes groups cleanly", () => {
  const slugs = ["gemini-3.9-pro-ultra", "gemini-3.9-pro-max"];
  const grouped = groupBases(slugs);
  const pro39 = grouped.get("gemini-3.9-pro");
  assertExists(pro39);
  assertEquals(pro39.has("ultra"), true);
  assertEquals(pro39.has("max"), true);

  const map = buildModelMap(grouped);
  const rw = map["auto-rw-gemini-3.9-pro"] as {
    reasoning?: boolean;
    interleaved?: { field: string };
    capabilities?: unknown;
    variants: Record<string, { reasoningEffort: string }>;
  };
  assertExists(rw);
  assertEquals(rw.reasoning, true);
  assertEquals(rw.interleaved, { field: "reasoning_content" });
  assertEquals(rw.capabilities, undefined);
  assertEquals(rw.variants.ultra.reasoningEffort, "ultra");
  assertEquals(rw.variants.max.reasoningEffort, "max");
});

Deno.test("dynamic effort: FALLBACK_MODELS equivalence (8 bases, 16 models, correct reasoning)", () => {
  const grouped = groupBases(FALLBACK_MODELS);
  assertEquals(grouped.size, 8);
  const map = buildModelMap(grouped);
  assertEquals(Object.keys(map).length, 16);

  // Check singletons vs non-singletons
  const singleton = map["auto-ro-claude-sonnet-4-6"] as {
    reasoning?: boolean;
    interleaved?: unknown;
    capabilities?: unknown;
    variants: Record<string, unknown>;
  };
  assertEquals(singleton.reasoning, undefined);
  assertEquals(singleton.interleaved, undefined);
  assertEquals(singleton.capabilities, undefined);
  assertEquals(Object.keys(singleton.variants).length, 0);

  const flash37 = map["auto-rw-gemini-3.7-flash"] as {
    reasoning?: boolean;
    interleaved?: { field: string };
    capabilities?: unknown;
    variants: Record<string, { reasoningEffort: string }>;
  };
  assertEquals(flash37.reasoning, true);
  assertEquals(flash37.interleaved, { field: "reasoning_content" });
  assertEquals(flash37.capabilities, undefined);
  assertEquals(flash37.variants.high.reasoningEffort, "high");
  assertEquals(flash37.variants.medium.reasoningEffort, "medium");
  assertEquals(flash37.variants.low.reasoningEffort, "low");

  const flash38 = map["auto-rw-gemini-3.8-flash"] as {
    reasoning?: boolean;
    interleaved?: { field: string };
    capabilities?: unknown;
    variants: Record<string, { reasoningEffort: string }>;
  };
  assertEquals(flash38.reasoning, true);
  assertEquals(flash38.interleaved, { field: "reasoning_content" });
  assertEquals(flash38.capabilities, undefined);
  assertEquals(flash38.variants.high.reasoningEffort, "high");
  assertEquals(flash38.variants.medium.reasoningEffort, "medium");
  assertEquals(flash38.variants.low.reasoningEffort, "low");
});

// --- resolveSlugs & Fallback Chain Tests (Tasks 2.2, 4.3, 4.4) ---

Deno.test("resolveSlugs: tier 1 TSV success returns source 'tsv'", async () => {
  const mockRunner = async () => ({
    code: 0,
    stdout: "gemini-3.7-flash-high\tGemini Flash\nclaude-sonnet-4-6\tSonnet\n",
    stderr: "",
  });

  const res = await resolveSlugs({ runner: mockRunner });
  assertEquals(res.source, "tsv");
  assertEquals(res.slugs, ["gemini-3.7-flash-high", "claude-sonnet-4-6"]);
});

Deno.test("resolveSlugs: tier 1 fails (non-zero exit) -> tier 2 API success returns source 'api'", async () => {
  const mockRunner = async () => ({
    code: 1,
    stdout: "",
    stderr: "error: unauthenticated",
  });
  const mockFetcher = async () =>
    new Response(
      JSON.stringify({
        data: [
          { id: "gemini-3.7-flash-high" },
          { id: "claude-opus-4-6-thinking" },
        ],
      }),
      { status: 200 },
    );

  const res = await resolveSlugs({
    runner: mockRunner,
    fetcher: mockFetcher,
  });
  assertEquals(res.source, "api");
  assertEquals(res.slugs, [
    "gemini-3.7-flash-high",
    "claude-opus-4-6-thinking",
  ]);
});

Deno.test("5.1 RED test: fetcher receives Authorization: Bearer header", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  const mockRunner = () =>
    Promise.resolve({
      code: 1,
      stdout: "",
      stderr: "error: unauthenticated",
    });
  const mockFetcher = (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          data: [{ id: "gemini-3.8-flash-high" }],
        }),
        { status: 200 },
      ),
    );
  };

  const res = await resolveSlugs({
    runner: mockRunner,
    fetcher: mockFetcher,
    token: "secret-test-token-12345",
  });

  assertEquals(res.source, "api");
  assertEquals(capturedUrl, "http://127.0.0.1:7421/v1/models");
  assertEquals(
    (capturedInit?.headers as Record<string, string>)?.[
      "Authorization"
    ],
    "Bearer secret-test-token-12345",
  );
});

Deno.test("5.1 triangulation: fetcher omits Authorization header when token is empty", async () => {
  let capturedInit: RequestInit | undefined;

  const mockRunner = () =>
    Promise.resolve({
      code: 1,
      stdout: "",
      stderr: "error: unauthenticated",
    });
  const mockFetcher = (_url: string, init?: RequestInit) => {
    capturedInit = init;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          data: [{ id: "gemini-3.8-flash-high" }],
        }),
        { status: 200 },
      ),
    );
  };

  const res = await resolveSlugs({
    runner: mockRunner,
    fetcher: mockFetcher,
    token: "",
  });

  assertEquals(res.source, "api");
  assertEquals(
    (capturedInit?.headers as Record<string, string> | undefined)?.[
      "Authorization"
    ],
    undefined,
  );
});

Deno.test("resolveSlugs: tier 1 runner throws (bad binary) -> tier 2 API success", async () => {
  const mockRunner = async () => {
    throw new Error("Executable not found: /invalid/path/agy");
  };
  const mockFetcher = async () =>
    new Response(
      JSON.stringify({
        data: [{ id: "gpt-oss-120b-medium" }],
      }),
      { status: 200 },
    );

  const res = await resolveSlugs({
    agyBin: "/invalid/path/agy",
    runner: mockRunner,
    fetcher: mockFetcher,
  });
  assertEquals(res.source, "api");
  assertEquals(res.slugs, ["gpt-oss-120b-medium"]);
});

Deno.test("resolveSlugs: tier 1 empty output -> tier 2 API success", async () => {
  const mockRunner = async () => ({
    code: 0,
    stdout: "id\tname\n", // only header -> parsed is []
    stderr: "",
  });
  const mockFetcher = async () =>
    new Response(
      JSON.stringify({
        data: [{ id: "gemini-3.6-flash-low" }],
      }),
      { status: 200 },
    );

  const res = await resolveSlugs({
    runner: mockRunner,
    fetcher: mockFetcher,
  });
  assertEquals(res.source, "api");
  assertEquals(res.slugs, ["gemini-3.6-flash-low"]);
});

Deno.test("resolveSlugs: tier 1 and tier 2 fail -> tier 3 FALLBACK returns 17 models and source 'fallback'", async () => {
  const mockRunner = async () => {
    throw new Error("agy not found");
  };
  const mockFetcher = async () => {
    throw new Error("Connection refused: 127.0.0.1:7421");
  };

  const res = await resolveSlugs({
    runner: mockRunner,
    fetcher: mockFetcher,
  });
  assertEquals(res.source, "fallback");
  assertEquals(res.slugs, [...FALLBACK_MODELS]);
  assertEquals(res.slugs.length, 17);
});

Deno.test("resolveSlugs: threat matrix — subprocess timeout or error never crashes and falls back safely", async () => {
  // Simulate a hanging process or rejection
  const mockRunner = async () => {
    await new Promise((r) => setTimeout(r, 10));
    throw new Error("Subprocess timed out after 10000ms");
  };
  const mockFetcher = async () =>
    new Response("Not Found", { status: 404 });

  const res = await resolveSlugs({
    runner: mockRunner,
    fetcher: mockFetcher,
  });
  // Must fall all the way to fallback without unhandled throw
  assertEquals(res.source, "fallback");
  assertEquals(res.slugs.length, 17);
});

// --- syncModels Atomic Write & Dry-Run Tests (Tasks 2.4, 2.5, 4.5, 4.6) ---

function createMemoryFs(initialFiles: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initialFiles));
  const dirs = new Set<string>();

  return {
    files,
    dirs,
    fs: {
      readTextFile: async (path: string) => {
        if (!files.has(path)) {
          throw new Error(`NotFound: file ${path}`);
        }
        return files.get(path)!;
      },
      writeTextFile: async (path: string, data: string) => {
        files.set(path, data);
      },
      rename: async (oldPath: string, newPath: string) => {
        if (!files.has(oldPath)) {
          throw new Error(`NotFound: file ${oldPath}`);
        }
        const content = files.get(oldPath)!;
        files.delete(oldPath);
        files.set(newPath, content);
      },
      mkdir: async (path: string) => {
        dirs.add(path);
      },
    },
  };
}

Deno.test("syncModels: atomic write preserves other providers and creates .bak backup", async () => {
  const configPath = "/test/opencode.json";
  const initialConfig = {
    plugin: ["agy-bridge"],
    provider: {
      anthropic: {
        npm: "@ai-sdk/anthropic",
        models: {
          "claude-3-5-sonnet": {},
        },
      },
      "agy-bridge": {
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: "http://127.0.0.1:7421/v1" },
        models: {
          "stale-model": {},
        },
      },
    },
  };
  const { files, fs } = createMemoryFs({
    [configPath]: JSON.stringify(initialConfig, null, 2),
  });

  const mockRunner = async () => ({
    code: 0,
    stdout: "gemini-3.7-flash-high\tGemini Flash\nclaude-sonnet-4-6\tSonnet\n",
    stderr: "",
  });

  const result = await syncModels({
    configPath,
    runner: mockRunner,
    fs,
    printJson: false,
  });

  assertEquals(result.source, "tsv");
  assertEquals(result.count, 4); // 2 bases * 2 profiles (ro/rw) = 4 models

  // Verify .bak file created with exact initial content
  const bakContent = files.get(`${configPath}.bak`);
  assertExists(bakContent);
  assertEquals(JSON.parse(bakContent), initialConfig);

  // Verify modified file
  const updatedContent = files.get(configPath);
  assertExists(updatedContent);
  const updatedConfig = JSON.parse(updatedContent);

  // Other providers and plugins preserved
  assertEquals(updatedConfig.plugin, ["agy-bridge"]);
  assertEquals(updatedConfig.provider.anthropic.npm, "@ai-sdk/anthropic");
  assertEquals(
    updatedConfig.provider.anthropic.models["claude-3-5-sonnet"],
    {},
  );

  // agy-bridge options preserved, models updated (stale model pruned)
  assertEquals(
    updatedConfig.provider["agy-bridge"].options.baseURL,
    "http://127.0.0.1:7421/v1",
  );
  assertEquals(
    updatedConfig.provider["agy-bridge"].models["stale-model"],
    undefined,
  );
  assertEquals(
    updatedConfig.provider["agy-bridge"].models["auto-ro-gemini-3.7-flash"]
      .reasoning,
    true,
  );
  assertEquals(
    updatedConfig.provider["agy-bridge"].models["auto-ro-gemini-3.7-flash"]
      .interleaved,
    { field: "reasoning_content" },
  );
  assertEquals(
    updatedConfig.provider["agy-bridge"].models["auto-ro-claude-sonnet-4-6"]
      .reasoning,
    undefined,
  );
  assertEquals(
    updatedConfig.provider["agy-bridge"].models["auto-ro-claude-sonnet-4-6"]
      .capabilities,
    undefined,
  );
});

Deno.test("syncModels: creates parent directories and file if not present", async () => {
  const configPath = "/test/nested/sub/opencode.json";
  const { files, fs, dirs } = createMemoryFs();
  const mockRunner = async () => {
    throw new Error("No agy binary");
  };
  const mockFetcher = async () => {
    throw new Error("No bridge");
  };

  const result = await syncModels({
    configPath,
    runner: mockRunner,
    fetcher: mockFetcher,
    fs,
    printJson: false,
  });

  assertEquals(result.source, "fallback");
  assertEquals(result.count, 16);
  assertEquals(dirs.has("/test/nested/sub"), true);

  const writtenContent = files.get(configPath);
  assertExists(writtenContent);
  const writtenConfig = JSON.parse(writtenContent);
  assertEquals(
    writtenConfig.provider["agy-bridge"].options.baseURL,
    "http://127.0.0.1:7421/v1",
  );
  assertEquals(
    Object.keys(writtenConfig.provider["agy-bridge"].models).length,
    16,
  );
});

Deno.test("syncModels: dryRun outputs models and makes zero file mutations", async () => {
  const configPath = "/test/opencode.json";
  const { files, fs } = createMemoryFs();
  const mockRunner = async () => ({
    code: 0,
    stdout: "gemini-3.7-flash-high\tGemini Flash\n",
    stderr: "",
  });

  const result = await syncModels({
    configPath,
    dryRun: true,
    printJson: false,
    runner: mockRunner,
    fs,
  });

  assertEquals(result.source, "tsv");
  assertEquals(result.count, 2); // auto-ro-gemini-3.7-flash & auto-rw-gemini-3.7-flash

  // File should NOT exist in memory fs
  assertEquals(files.has(configPath), false);
  assertEquals(files.has(`${configPath}.bak`), false);
});


