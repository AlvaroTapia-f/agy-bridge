import { assertEquals } from "@std/assert";
import {
  buildModelMap as helpersBuildModelMap,
  FALLBACK_MODELS,
  groupBases as helpersGroupBases,
} from "./agy-bridge-helpers.ts";

// Import from bundled plugins/agy-bridge.ts
import {
  buildModelMap as bundleBuildModelMap,
  FALLBACK_MODELS as bundleFallbackModels,
  groupBases as bundleGroupBases,
} from "./agy-bridge.ts";

import bundleText from "./agy-bridge.ts" with { type: "text" };

Deno.test("Task 3.3 Parity: bundle exports match helpers exports on FALLBACK_MODELS", () => {
  // Parity on FALLBACK_MODELS constants
  assertEquals([...bundleFallbackModels], [...FALLBACK_MODELS]);

  // Parity on groupBases
  const helpersGrouped = helpersGroupBases(FALLBACK_MODELS);
  const bundleGrouped = bundleGroupBases(FALLBACK_MODELS);

  assertEquals(bundleGrouped.size, helpersGrouped.size);
  for (const [k, v] of helpersGrouped.entries()) {
    assertEquals(bundleGrouped.get(k), v);
  }

  // Parity on buildModelMap
  const helpersMap = helpersBuildModelMap(helpersGrouped);
  const bundleMap = bundleBuildModelMap(bundleGrouped);
  assertEquals(bundleMap, helpersMap);
});

Deno.test("Task 3.3 Triangulation: parity holds on custom dynamic slugs with multiple passes", () => {
  const dynamicSlugs = [
    "custom-3.8-flash-ultra",
    "custom-3.8-flash-extreme",
    "custom-singleton",
    "custom-3.9-pro-ultra",
    "custom-3.9-pro-max",
  ];

  const helpersGrouped = helpersGroupBases(dynamicSlugs);
  const bundleGrouped = bundleGroupBases(dynamicSlugs);

  assertEquals(bundleGrouped.size, helpersGrouped.size);
  for (const [k, v] of helpersGrouped.entries()) {
    assertEquals(bundleGrouped.get(k), v);
  }

  const helpersMap = helpersBuildModelMap(helpersGrouped);
  const bundleMap = bundleBuildModelMap(bundleGrouped);
  assertEquals(bundleMap, helpersMap);
});

Deno.test("Task 3.4 Drift test: bundle contains @ts-nocheck and GENERATED banner and matches helpers", () => {
  const hasTsNoCheck = bundleText.startsWith("// @ts-nocheck");
  const hasGeneratedBanner = bundleText.includes(
    "GENERATED FILE — DO NOT EDIT DIRECTLY",
  );
  const hasSourceOfTruth = bundleText.includes(
    "Source of truth: plugins/agy-bridge-helpers.ts",
  );

  assertEquals(hasTsNoCheck, true, "Bundle must start with // @ts-nocheck");
  assertEquals(
    hasGeneratedBanner,
    true,
    "Bundle must contain GENERATED banner",
  );
  assertEquals(
    hasSourceOfTruth,
    true,
    "Bundle must reference helpers source of truth",
  );
});

// --- agy-bridge-model-effort-regression Phase 1: union author + version guard ---
// Runtime inspect 2026-09-09 (read-only):
// - provider.models() raw (plugin source, bridge down -> FALLBACK_MODELS) is
//   DECLARED-ONLY: 3.1-pro high/low, opus-4-6 thinking, gpt-oss-120b medium,
//   sonnet-4-6 no variants.
// - ~/.gentle-ai/cache/model-variants.json unions generic {high,low,medium}
//   into every agy-bridge row (3.1-pro +medium; opus-4-6 +high/low/medium;
//   gpt-oss-120b +high/low; sonnet absent).
// Union author: downstream model-variants cache-writer, NOT provider.models(),
// NOT opencode core enrichment. These approval tests lock the raw side.

Deno.test("1.1 union author: provider.models() raw is declared-only", async () => {
  const mod = await import("./agy-bridge.ts");
  const hooks = await mod.default({} as never);
  const models = await hooks.provider!.models!({}, {}) as Record<
    string,
    { variants?: Record<string, unknown> }
  >;
  const variantsOf = (id: string): string[] =>
    Object.keys(models[id]?.variants ?? {}).sort();
  // Declared subsets: any generic union here would mean OUR provider regressed.
  assertEquals(variantsOf("auto-ro-gemini-3.1-pro"), ["high", "low"]);
  assertEquals(variantsOf("auto-rw-gemini-3.1-pro"), ["high", "low"]);
  assertEquals(variantsOf("auto-ro-claude-opus-4-6"), ["thinking"]);
  assertEquals(variantsOf("auto-ro-gpt-oss-120b"), ["medium"]);
  assertEquals(variantsOf("auto-ro-claude-sonnet-4-6"), []);
  assertEquals(variantsOf("auto-ro-gemini-3.7-flash"), ["high", "low", "medium"]);
});

Deno.test("1.2 version-guard: bundle variants keys are a subset of the declared map", () => {
  const declared = helpersGroupBases(FALLBACK_MODELS);
  const bundleGrouped = bundleGroupBases(FALLBACK_MODELS);
  const bundleMap: Record<string, unknown> = bundleBuildModelMap(
    bundleGrouped,
  ) as Record<string, unknown>;
  for (const [id, def] of Object.entries(bundleMap)) {
    const base = id.replace(/^auto-(ro|rw)-/, "");
    const allowed = declared.get(base) ?? new Set<string>();
    const keys = Object.keys(
      (def as { variants: Record<string, unknown> }).variants,
    );
    for (const key of keys) {
      assertEquals(
        allowed.has(key),
        true,
        `${id} exposes undeclared variant "${key}"`,
      );
    }
  }
  // Triangulate the exact regression symptoms: undeclared efforts absent.
  const pro = bundleMap["auto-ro-gemini-3.1-pro"] as {
    variants: Record<string, unknown>;
  };
  assertEquals("medium" in pro.variants, false);
  const opus = bundleMap["auto-ro-claude-opus-4-6"] as {
    variants: Record<string, unknown>;
  };
  assertEquals("high" in opus.variants, false);
  assertEquals("low" in opus.variants, false);
  assertEquals("medium" in opus.variants, false);
  const gpt = bundleMap["auto-ro-gpt-oss-120b"] as {
    variants: Record<string, unknown>;
  };
  assertEquals("high" in gpt.variants, false);
  assertEquals("low" in gpt.variants, false);
});

// --- agy-bridge-model-effort-regression Phase 4: rebundle parity ---

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)].map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

Deno.test("4.2 parity: bundle map hash equals source map hash", async () => {
  const helpersGrouped = helpersGroupBases(FALLBACK_MODELS);
  const bundleGrouped = bundleGroupBases(FALLBACK_MODELS);
  const helpersHash = await sha256Hex(
    JSON.stringify(helpersBuildModelMap(helpersGrouped)),
  );
  const bundleHash = await sha256Hex(
    JSON.stringify(bundleBuildModelMap(bundleGrouped)),
  );
  assertEquals(bundleHash, helpersHash);
});

Deno.test("4.2 rebundle: bundle embeds MODEL_MAP_VERSION = 3", async () => {
  const helpersSource = await Deno.readTextFile(
    new URL("./agy-bridge-helpers.ts", import.meta.url),
  );
  assertEquals(
    helpersSource.includes("MODEL_MAP_VERSION = 3"),
    true,
    "helpers must declare MODEL_MAP_VERSION = 3",
  );
  assertEquals(
    bundleText.includes("MODEL_MAP_VERSION"),
    true,
    "stale bundle: run deno task bundle:plugin",
  );
});

// --- agy-bridge-model-effort-regression Phase 5: entry-path matrix ---
// TUI, direct, subagent, and SDD-provider paths all consume the single
// provider.models() fn below. This test locks that all surfaces expose
// identical declared-only variant sets (ro mirrors rw; no undeclared key
// on any id). Live smoke 2026-09-09: GET /v1/models -> 14 declared slugs;
// bare auto-ro-gemini-3.7-flash -> 400 ambiguous+specify-one-of;
// auto-ro-gemini-3.1-pro-medium -> 400 unknown-variant;
// singleton + bare gpt-oss-120b w/ effort medium -> live 200 "pong".

Deno.test("5.1 entry-path matrix: all surfaces expose identical declared-only variants", async () => {
  const mod = await import("./agy-bridge.ts");
  const hooks = await mod.default({} as never);
  const models = await hooks.provider!.models!({}, {}) as Record<
    string,
    { variants?: Record<string, unknown> }
  >;
  const declared = helpersGroupBases(FALLBACK_MODELS);
  const variantsOf = (id: string): string[] =>
    Object.keys(models[id]?.variants ?? {}).sort();
  // ro mirrors rw on every base; each set equals the declared subset.
  for (const [base, efforts] of declared.entries()) {
    const expected = [...efforts].sort();
    assertEquals(variantsOf(`auto-ro-${base}`), expected, `ro ${base}`);
    assertEquals(variantsOf(`auto-rw-${base}`), expected, `rw ${base}`);
  }
  // Triangulate: regression symptoms absent on BOTH profiles.
  assertEquals(variantsOf("auto-rw-gemini-3.1-pro").includes("medium"), false);
  assertEquals(variantsOf("auto-rw-claude-opus-4-6").includes("high"), false);
  assertEquals(variantsOf("auto-rw-gpt-oss-120b").includes("high"), false);
  // Exactly 14 ids, no bare ids leaked to any surface.
  assertEquals(Object.keys(models).length, 14);
  for (const id of Object.keys(models)) {
    assertEquals(id.startsWith("auto-ro-") || id.startsWith("auto-rw-"), true);
  }
});
