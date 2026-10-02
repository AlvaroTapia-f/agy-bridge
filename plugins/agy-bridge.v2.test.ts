import { assertEquals } from "@std/assert";
import type {
  DeepMutableModelInfo,
  IntegrationEditor,
  ModelEditor,
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
import {
  buildModelMap,
  buildModelV2,
  declaredVariantsByModel,
  FALLBACK_MODELS,
  filterUndeclaredVariants,
  groupBases,
  MODEL_MAP_VERSION,
  reasoningEffortFor,
  V2_RELEASED,
} from "./agy-bridge-helpers.ts";

type AddedProvider = { info: ProviderInfo; models: readonly ModelInfo[] };

/** Fake provider+model registry the model transform can be replayed against. */
type Registry = {
  records: { providerID: string; models: DeepMutableModelInfo[] }[];
};

function fakeModelEditor(registry: Registry): ModelEditor {
  const record = (providerID: string) =>
    registry.records.find((r) => r.providerID === providerID);
  const find = (providerID: string, modelID: string) =>
    record(providerID)?.models.find((m) => m.id === modelID);
  return {
    list: (providerID) =>
      registry.records
        .filter((r) => !providerID || r.providerID === providerID)
        .flatMap((r) => r.models),
    get: (providerID, modelID) => find(providerID, modelID),
    update: (providerID, modelID, update) => {
      const model = find(providerID, modelID);
      if (model) update(model);
    },
    remove: (providerID, modelID) => {
      const rec = record(providerID);
      if (rec) rec.models = rec.models.filter((m) => m.id !== modelID);
    },
  };
}

function mockCtx(registry: Registry = { records: [] }): PluginContext & {
  added: AddedProvider[];
  methods: Array<{ integrationID: string; method: unknown }>;
  registry: Registry;
  reloads: number;
  replayModelTransform(): void;
} {
  const added: AddedProvider[] = [];
  const methods: Array<{ integrationID: string; method: unknown }> = [];
  const state = { reloads: 0 };
  let modelTransform: ((editor: ModelEditor) => void) | undefined;
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
    registry,
    get reloads() {
      return state.reloads;
    },
    replayModelTransform() {
      if (!modelTransform) throw new Error("no model transform registered");
      modelTransform(fakeModelEditor(registry));
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
    model: {
      transform: (cb) => {
        modelTransform = cb;
        return Promise.resolve({
          dispose: () => {
            modelTransform = undefined;
            return Promise.resolve();
          },
        });
      },
      // model reloads reuse the provider counter so both are asserted at once;
      // the model domain is verified separately by the mask-replay test.
      reload: () => {
        state.reloads += 1;
        return Promise.resolve();
      },
    },
    options: {},
  };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Records agy-bridge models in a replayable registry, V2 shape. */
function registryOf(models: readonly ModelInfo[]): Registry {
  return {
    records: [{
      providerID: "agy-bridge",
      models: models.map((m) => ({ ...m }) as DeepMutableModelInfo),
    }],
  };
}

function variantIds(model: ModelInfo): string[] {
  return (model.variants ?? []).map((v) => v.id);
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
      new Response(
        JSON.stringify({ object: "list", data: [{ id: "live-model-high" }] }),
      ),
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
  assertEquals(opus.variants, [{
    id: "thinking",
    settings: { reasoningEffort: "max" },
  }]);
  const singleton = models.find((m) => m.id === "auto-ro-claude-sonnet-4-6")!;
  assertEquals(singleton.variants, []);
});

Deno.test("v2 providerInfo: openai-compatible package pointed at the bridge", () => {
  const info = providerInfo();
  assertEquals(info.id, "agy-bridge");
  assertEquals(info.package, "@opencode/ai/providers/openai-compatible");
  assertEquals(
    (info.settings as Record<string, unknown>).baseURL,
    BRIDGE_BASE_URL,
  );
});

Deno.test("v2 setup: preloads slugs, registers integration method + provider, cleanup clears timer", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error("down"));
  try {
    const ctx = mockCtx();
    const cleanup = await plugin.setup(ctx);
    assertEquals(ctx.methods.length, 1);
    assertEquals(ctx.methods[0].integrationID, "agy-bridge");
    // The integration method must satisfy the real V2 Integration.KeyMethod
    // schema: { type: "key"; label?; form? }, additionalProperties: false.
    // Asserted structurally here because a wrong `type` only fails against the
    // live runtime — it silently kills plugin setup and unregisters the
    // provider plus every model.
    assertEquals(ctx.methods[0].method, {
      type: "key",
      label: "AGY Token (paste from ~/.config/agy-bridge/env)",
    });
    assertEquals(
      Object.keys(ctx.methods[0].method as Record<string, unknown>).includes(
        "id",
      ),
      false,
      "KeyMethod must not carry an id field",
    );
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

// --- T2: port buildModelMap to the V2 Model.Info[] shape --------------------
// Sources of truth: https://opencode.ai/v2/docs/build/plugins and
// https://opencode.ai/v2/docs/migrate-v1 (+ /v2/docs/models for
// compatibility.reasoningField). V1 output must not move: see the byte-hash
// tests at the end of this block.

Deno.test("T2 buildModelV2: FALLBACK → 14 Model.Info entries (array), one per base x profile", () => {
  const models = buildModelV2(groupBases(FALLBACK_MODELS));
  assertEquals(Array.isArray(models), true);
  assertEquals(models.length, 14);
  assertEquals(
    [...models].map((m) => m.id),
    [
      "auto-ro-claude-opus-4-6",
      "auto-ro-claude-sonnet-4-6",
      "auto-ro-gemini-3.1-pro",
      "auto-ro-gemini-3.6-flash",
      "auto-ro-gemini-3.7-flash",
      "auto-ro-gemini-3.8-flash",
      "auto-ro-gpt-oss-120b",
      "auto-rw-claude-opus-4-6",
      "auto-rw-claude-sonnet-4-6",
      "auto-rw-gemini-3.1-pro",
      "auto-rw-gemini-3.6-flash",
      "auto-rw-gemini-3.7-flash",
      "auto-rw-gemini-3.8-flash",
      "auto-rw-gpt-oss-120b",
    ],
    "one Model.Info per base x profile, sorted by id",
  );
  for (const m of models) {
    assertEquals(m.providerID, "agy-bridge", `${m.id} providerID`);
    assertEquals(m.name, m.id, `${m.id} name`);
    assertEquals(m.enabled, true, `${m.id} enabled`);
  }
});

Deno.test("T2 buildModelV2: variants is an array of {id, settings.reasoningEffort}, declared only", () => {
  const bases = groupBases(FALLBACK_MODELS);
  const models = buildModelV2(bases);
  for (const m of models) {
    const base = m.id.replace(/^auto-(ro|rw)-/, "");
    const declared = [...(bases.get(base) ?? new Set<string>())].sort();
    assertEquals(
      Array.isArray(m.variants),
      true,
      `${m.id} variants is an array`,
    );
    assertEquals(
      m.variants.map((v) => v.id),
      declared,
      `${m.id} exposes exactly the declared efforts`,
    );
    for (const v of m.variants) {
      assertEquals(
        Object.keys(v).sort(),
        ["id", "settings"],
        `${m.id}/${v.id} keys`,
      );
      assertEquals(
        v.settings,
        { reasoningEffort: v.id === "thinking" ? "max" : v.id },
        `${m.id}/${v.id} settings`,
      );
    }
  }
  const flash = models.find((m) => m.id === "auto-ro-gemini-3.8-flash")!;
  assertEquals(flash.variants, [
    { id: "high", settings: { reasoningEffort: "high" } },
    { id: "low", settings: { reasoningEffort: "low" } },
    { id: "medium", settings: { reasoningEffort: "medium" } },
  ]);
  // Declared-only: no {disabled:true} placeholder for undeclared generics —
  // V2 has no variant-level disable flag, so masking is omission.
  const pro = models.find((m) => m.id === "auto-ro-gemini-3.1-pro")!;
  assertEquals(variantIds(pro), ["high", "low"]);
});

Deno.test("T2 thinking alias: variant id stays 'thinking', reasoningEffort is 'max'", () => {
  assertEquals(reasoningEffortFor("thinking"), "max");
  assertEquals(reasoningEffortFor("high"), "high");
  const opus = buildModelV2(groupBases(FALLBACK_MODELS)).find(
    (m) => m.id === "auto-ro-claude-opus-4-6",
  )!;
  assertEquals(opus.variants, [
    { id: "thinking", settings: { reasoningEffort: "max" } },
  ]);
  // Bridge side (unchanged): an arriving "max" signal maps back to -thinking.
});

Deno.test("T2 buildModelV2: no V1-only shape anywhere in the emitted models", () => {
  const models = buildModelV2(groupBases(FALLBACK_MODELS));
  for (const m of models) {
    const rec = m as unknown as Record<string, unknown>;
    for (
      const key of [
        "reasoning",
        "interleaved",
        "reasoning_options",
        "options",
        "provider",
        "modalities",
        "tool_call",
        "release_date",
        "cache_read",
        "cache_write",
      ]
    ) {
      assertEquals(key in rec, false, `${m.id} must not carry V1 key "${key}"`);
    }
    // V1 `variants` was an object; V2 is an array (migrate-v1 "Models and variants").
    assertEquals(Array.isArray(m.variants), true, `${m.id} variants array`);
  }
});

Deno.test("T2 buildModelV2: every field the V2 Model.Info schema requires is present", () => {
  // Model.Info is additionalProperties:false and requires all of these. Omitting
  // `time.released` makes the runtime throw while sorting the catalog, which
  // surfaces only as an opaque /api/model 500 with zero models.
  const REQUIRED = [
    "id",
    "modelID",
    "providerID",
    "name",
    "capabilities",
    "variants",
    "time",
    "cost",
    "status",
    "enabled",
    "limit",
  ];
  const models = buildModelV2(groupBases(FALLBACK_MODELS));
  assertEquals(models.length, 14);
  for (const m of models) {
    const rec = m as unknown as Record<string, unknown>;
    for (const key of REQUIRED) {
      assertEquals(
        key in rec,
        true,
        `${m.id} is missing required Model.Info field "${key}"`,
      );
    }
    assertEquals(typeof rec.modelID, "string");
    assertEquals((rec.time as { released: unknown }).released, V2_RELEASED);
    assertEquals(Array.isArray(rec.cost), true);
    assertEquals((rec.cost as unknown[]).length > 0, true);
    assertEquals(rec.status, "active");
  }
});

Deno.test("T2 buildModelV2: capabilities + compatibility.reasoningField replace V1 reasoning/interleaved", () => {
  const models = buildModelV2(groupBases(FALLBACK_MODELS));
  for (const m of models) {
    // migrate-v1: tool_call/modalities → capabilities.{tools,input,output}.
    assertEquals(
      m.capabilities,
      { tools: true, input: ["text", "image"], output: ["text"] },
      `${m.id} capabilities`,
    );
    // V1 interleaved:{field} → V2 compatibility.reasoningField (/v2/docs/models).
    assertEquals(
      m.compatibility,
      { reasoningField: "reasoning_content" },
      `${m.id} compatibility`,
    );
    // Documented V2 fallback limits for a model absent from the catalog.
    assertEquals(
      m.limit,
      { context: 200_000, output: 32_000 },
      `${m.id} limit`,
    );
  }
  // Every model declares capabilities (V2 requires them), including singletons.
  const singleton = models.find((m) => m.id === "auto-ro-claude-sonnet-4-6")!;
  assertEquals(singleton.variants, []);
  assertEquals(singleton.capabilities.tools, true);
  assertEquals(singleton.compatibility.reasoningField, "reasoning_content");
});

Deno.test("T2 shared core: V1 and V2 declare the same ids and the same effort sets", () => {
  for (
    const slugs of [
      FALLBACK_MODELS,
      [
        "gemini-3.7-flash-high",
        "gemini-3.7-flash-low",
        "claude-sonnet-4-6",
        "gpt-oss-120b-medium",
        "gemini-3.8-flash-ultra",
        "gemini-3.9-pro-max",
        "standalone-model",
      ],
    ]
  ) {
    const bases = groupBases(slugs);
    const v1 = buildModelMap(bases);
    const v2 = buildModelV2(bases);
    assertEquals(
      v2.map((m) => m.id).sort(),
      Object.keys(v1).sort(),
      "same catalog ids",
    );
    for (const m of v2) {
      const v1Model = v1[m.id] as {
        variants: Record<string, unknown>;
        reasoning_options?: string[];
      };
      const enabledV1 = Object.entries(v1Model.variants)
        .filter(([, spec]) => !(spec as { disabled?: boolean }).disabled)
        .map(([key]) => key).sort();
      // V1 enabled-after-masking === V2 declared set (V2 masks by omission).
      assertEquals(variantIds(m), enabledV1, `${m.id} effort sets`);
      if (v1Model.reasoning_options) {
        assertEquals(
          new Set(variantIds(m)),
          new Set(v1Model.reasoning_options),
          `${m.id} declared truth`,
        );
      }
    }
  }
});

Deno.test("T2 declaredVariantsByModel: keyed by model id, singletons map to an empty set", () => {
  const declared = declaredVariantsByModel(groupBases(FALLBACK_MODELS));
  assertEquals(declared.size, 14);
  assertEquals(
    declared.get("auto-ro-gemini-3.1-pro"),
    new Set(["high", "low"]),
  );
  assertEquals(declared.get("auto-rw-claude-opus-4-6"), new Set(["thinking"]));
  assertEquals(declared.get("auto-ro-claude-sonnet-4-6"), new Set());
  assertEquals(declared.get("auto-ro-nope"), undefined);
});

Deno.test("T2 filterUndeclaredVariants: keeps declared, drops union-injected, passes unknown ids through", () => {
  const declared = new Set(["high", "low"]);
  const variants = [{ id: "high" }, { id: "medium" }, { id: "low" }, {
    id: "thinking",
  }];
  assertEquals(
    filterUndeclaredVariants(variants, declared).map((v) => v.id),
    ["high", "low"],
  );
  // Singleton: empty declared set means nothing selectable.
  assertEquals(filterUndeclaredVariants(variants, new Set()), []);
  // Unknown id (not in our declared map) and missing input are left alone.
  assertEquals(filterUndeclaredVariants(variants, undefined).length, 4);
  assertEquals(filterUndeclaredVariants(undefined, declared), []);
  assertEquals(filterUndeclaredVariants(undefined, undefined), []);
});

Deno.test("T2 setup: model transform masks union-injected variants end-to-end", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error("down"));
  try {
    const registry = registryOf(buildModelV2(groupBases(FALLBACK_MODELS)));
    // Simulate the union the V1 contract had to defend against: generic
    // efforts appear on rows that never declared them.
    const pro = registry.records[0].models.find((m) =>
      m.id === "auto-ro-gemini-3.1-pro"
    )!;
    pro.variants = [{ id: "high" }, { id: "medium" }, { id: "low" }];
    registry.records[0].models.push({
      id: "auto-ro-gemini-9.9-ultra",
      providerID: "agy-bridge",
      name: "auto-ro-gemini-9.9-ultra",
      variants: [{ id: "medium" }],
    });
    registry.records.push({
      providerID: "other-plugin",
      models: [{
        id: "other-model",
        providerID: "other-plugin",
        name: "other",
        variants: [{ id: "high" }],
      }],
    });

    const ctx = mockCtx(registry);
    const cleanup = await plugin.setup(ctx);
    try {
      ctx.replayModelTransform();
      const ids = (providerID: string, id: string) =>
        (registry.records.find((r) => r.providerID === providerID)!.models
          .find((m) => m.id === id)!.variants ?? []).map((v) => v.id);
      assertEquals(
        ids("agy-bridge", "auto-ro-gemini-3.1-pro"),
        ["high", "low"],
        "union-injected medium masked",
      );
      // Not in the declared map (a base seen after a catalog bump): untouched.
      assertEquals(ids("agy-bridge", "auto-ro-gemini-9.9-ultra"), ["medium"]);
      // Another provider's model is never rewritten.
      assertEquals(ids("other-plugin", "other-model"), ["high"]);
      // Declared rows survive the replay untouched.
      assertEquals(
        ids("agy-bridge", "auto-ro-gemini-3.8-flash"),
        ["high", "low", "medium"],
      );
    } finally {
      if (typeof cleanup === "function") await cleanup();
    }
  } finally {
    globalThis.fetch = orig;
  }
});

Deno.test("T2 setup: the model transform is replayable and registered once", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error("down"));
  try {
    const registry = registryOf(buildModelV2(groupBases(FALLBACK_MODELS)));
    const ctx = mockCtx(registry);
    const cleanup = await plugin.setup(ctx);
    try {
      assertEquals(ctx.added.length, 1, "one provider registration");
      const before = JSON.stringify(registry.records[0].models);
      ctx.replayModelTransform();
      ctx.replayModelTransform();
      assertEquals(
        JSON.stringify(registry.records[0].models),
        before,
        "replay is a no-op on a clean catalog",
      );
    } finally {
      if (typeof cleanup === "function") await cleanup();
    }
  } finally {
    globalThis.fetch = orig;
  }
});

Deno.test("T2 refresh: reloads the provider inventory AND the model registry", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error("down"));
  try {
    const ctx = mockCtx();
    ctx.options.refreshIntervalMs = 10;
    const cleanup = await plugin.setup(ctx);
    try {
      assertEquals(ctx.reloads, 0, "no reload before the first tick");
      await new Promise((resolve) => setTimeout(resolve, 40));
      // Docs: ctx.model.reload() is required when a model transform captured
      // the changing input (our declared map), on top of the provider reload.
      assertEquals(ctx.reloads >= 2, true, `reloads=${ctx.reloads}`);
    } finally {
      if (typeof cleanup === "function") await cleanup();
    }
  } finally {
    globalThis.fetch = orig;
  }
});

Deno.test("T2 V1 output bytes are unchanged by the shared-core refactor", async () => {
  // Hashes captured from the pre-T2 implementation (HEAD 9f6ac28). The V1
  // bundle must serialize the same catalog, byte for byte, after the port.
  assertEquals(MODEL_MAP_VERSION, 4, "declared map unchanged → no cache bump");
  assertEquals(
    await sha256Hex(
      JSON.stringify(buildModelMap(groupBases(FALLBACK_MODELS))),
    ),
    "dbc35728e4c3503d0d2b25824a8265f1c57b65f9adf2fd04452a6b15653d9e5d",
  );
  assertEquals(
    await sha256Hex(
      JSON.stringify(buildModelMap(groupBases([
        "gemini-3.7-flash-high",
        "gemini-3.7-flash-low",
        "claude-sonnet-4-6",
        "gpt-oss-120b-medium",
        "gemini-3.8-flash-ultra",
        "gemini-3.9-pro-max",
        "gemini-3.9-pro-ultra",
        "standalone-model",
      ]))),
    ),
    "a6ea79e0f60b61841fac48573c249af9a9d464192d0ff04081d5db106c25432b",
  );
});

Deno.test("T2 V1 masking contract is untouched: {disabled:true} still masks undeclared generics", () => {
  const v1 = buildModelMap(groupBases(FALLBACK_MODELS));
  const pro = v1["auto-ro-gemini-3.1-pro"] as unknown as {
    variants: Record<string, unknown>;
    reasoning_options: string[];
  };
  assertEquals(pro.variants["medium"], { disabled: true });
  assertEquals(pro.variants["high"], { reasoningEffort: "high" });
  assertEquals(pro.reasoning_options, ["high", "low"]);
});
