import { assertEquals } from "@std/assert";
import type {
  IntegrationEditor,
  ModelInfo,
  PluginContext,
  ProviderEditor,
  ProviderInfo,
} from "../stubs/opencode-plugin-v2.ts";
import {
  BRIDGE_BASE_URL,
  buildV2Models,
  providerInfo,
  resolveSlugs,
} from "./agy-bridge.v2.ts";
import plugin from "./agy-bridge.v2.ts";
import { FALLBACK_MODELS, groupBases } from "./agy-bridge-helpers.ts";

type AddedProvider = { info: ProviderInfo; models: readonly ModelInfo[] };

function mockCtx(): PluginContext & {
  added: AddedProvider[];
  methods: Array<{ integrationID: string; method: unknown }>;
  reloads: number;
} {
  const added: AddedProvider[] = [];
  const methods: Array<{ integrationID: string; method: unknown }> = [];
  const state = { reloads: 0 };
  const providerEditor: ProviderEditor = {
    add: (input) => {
      added.push(input);
    },
  };
  const integrationEditor: IntegrationEditor = {
    method: {
      list: () => [],
      update: (input) => {
        methods.push(input);
      },
      remove: () => {},
    },
  };
  return {
    added,
    methods,
    get reloads() {
      return state.reloads;
    },
    integration: {
      transform: (cb) => {
        cb(integrationEditor);
        return Promise.resolve({ dispose: () => Promise.resolve() });
      },
      reload: () => Promise.resolve(),
      connection: {
        active: () => Promise.resolve(undefined),
        resolve: () => Promise.resolve(undefined),
      },
    },
    provider: {
      transform: (cb) => {
        cb(providerEditor);
        return Promise.resolve({ dispose: () => Promise.resolve() });
      },
      reload: () => {
        state.reloads += 1;
        return Promise.resolve();
      },
    },
    options: {},
  };
}

Deno.test("v2 entrypoint: plugin id is agy-bridge", () => {
  assertEquals(plugin.id, "agy-bridge");
});

Deno.test("v2 resolveSlugs: falls back to FALLBACK_MODELS when bridge unreachable", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error("down"));
  try {
    assertEquals(await resolveSlugs(), [...FALLBACK_MODELS]);
  } finally {
    globalThis.fetch = orig;
  }
});

Deno.test("v2 resolveSlugs: returns live ids when bridge responds", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ object: "list", data: [{ id: "live-model-high" }] })),
    );
  try {
    assertEquals(await resolveSlugs("k"), ["live-model-high"]);
  } finally {
    globalThis.fetch = orig;
  }
});

Deno.test("v2 buildV2Models: FALLBACK yields 14 ids, variants array, no V1 shape", () => {
  const models = buildV2Models(FALLBACK_MODELS);
  const bases = groupBases(FALLBACK_MODELS);
  assertEquals(bases.size, 7);
  assertEquals(models.length, 14);
  for (const m of models) {
    const rec = m as unknown as Record<string, unknown>;
    // No V1-only output shape (acceptance: T1 must not emit it).
    assertEquals("reasoning" in rec, false, `${m.id} reasoning`);
    assertEquals("interleaved" in rec, false, `${m.id} interleaved`);
    assertEquals(Array.isArray(m.variants), true, `${m.id} variants array`);
    const base = m.id.replace(/^auto-(ro|rw)-/, "");
    const expected = [...(bases.get(base) ?? new Set<string>())].sort();
    assertEquals(m.variants!.map((v) => v.id), expected, `${m.id} variant ids`);
  }
  const opus = models.find((m) => m.id === "auto-ro-claude-opus-4-6")!;
  assertEquals(opus.variants, [{ id: "thinking", settings: { reasoningEffort: "max" } }]);
  const singleton = models.find((m) => m.id === "auto-ro-claude-sonnet-4-6")!;
  assertEquals(singleton.variants, []);
});

Deno.test("v2 providerInfo: openai-compatible package pointed at the bridge", () => {
  const info = providerInfo();
  assertEquals(info.id, "agy-bridge");
  assertEquals(info.package, "@opencode/ai/providers/openai-compatible");
  assertEquals((info.settings as Record<string, unknown>).baseURL, BRIDGE_BASE_URL);
});

Deno.test("v2 setup: preloads slugs, registers integration method + provider, cleanup clears timer", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error("down"));
  try {
    const ctx = mockCtx();
    const cleanup = await plugin.setup(ctx);
    assertEquals(ctx.methods.length, 1);
    assertEquals(ctx.methods[0].integrationID, "agy-bridge");
    assertEquals(ctx.added.length, 1);
    assertEquals(ctx.added[0].info.id, "agy-bridge");
    // Preloaded fallback catalog (bridge down): 7 bases x 2 profiles.
    assertEquals(ctx.added[0].models.length, 14);
    assertEquals(typeof cleanup === "function" || cleanup === undefined, true);
    if (typeof cleanup === "function") await cleanup();
  } finally {
    globalThis.fetch = orig;
  }
});
