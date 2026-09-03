// RED test for bridge-effort-reasoning-exposure
// Must fail before implementation (2.1) and pass after — strict TDD.
import { assertEquals } from "jsr:@std/assert";
import { stripEffortSuffix, groupBases, wireModel, FALLBACK_MODELS, buildModelMap } from "./agy-bridge-helpers.ts";

import { groupBases as pluginGroupBases } from "./agy-bridge.ts";

Deno.test("stripEffortSuffix: gemini-3.7-flash-high → base+high", () => {
  const r = stripEffortSuffix("gemini-3.7-flash-high");
  assertEquals(r.base, "gemini-3.7-flash");
  assertEquals(r.variant, "high");
});

Deno.test("stripEffortSuffix: claude-sonnet-4-6 → no variant", () => {
  const r = stripEffortSuffix("claude-sonnet-4-6");
  assertEquals(r.base, "claude-sonnet-4-6");
  assertEquals(r.variant, undefined);
});

Deno.test("stripEffortSuffix: claude-opus-4-6-thinking → base+thinking", () => {
  const r = stripEffortSuffix("claude-opus-4-6-thinking");
  assertEquals(r.base, "claude-opus-4-6");
  assertEquals(r.variant, "thinking");
});

Deno.test("stripEffortSuffix: gpt-oss-120b-medium → base+medium", () => {
  const r = stripEffortSuffix("gpt-oss-120b-medium");
  assertEquals(r.base, "gpt-oss-120b");
  assertEquals(r.variant, "medium");
});

Deno.test("groupBases: 17 FALLBACK → 8 bases with variant subsets", () => {
  const grouped = groupBases(FALLBACK_MODELS);
  // Should dedupe to 8 distinct bases (17 slugs)
  assertEquals(grouped.size, 8);
  const flash37 = grouped.get("gemini-3.7-flash");
  assertEquals(flash37, new Set(["high", "medium", "low"]));
  const flash38 = grouped.get("gemini-3.8-flash");
  assertEquals(flash38, new Set(["high", "medium", "low"]));
  const singleton = grouped.get("claude-sonnet-4-6");
  assertEquals(singleton, new Set());
  const opus = grouped.get("claude-opus-4-6");
  assertEquals(opus, new Set(["thinking"]));
});

Deno.test("wireModel: high variant yields suffixed wire id", () => {
  assertEquals(wireModel("auto-ro-gemini-3.7-flash", "high"), "auto-ro-gemini-3.7-flash-high");
});

Deno.test("wireModel: no variant yields verbatim", () => {
  assertEquals(wireModel("auto-ro-gemini-3.7-flash"), "auto-ro-gemini-3.7-flash");
  assertEquals(wireModel("auto-ro-claude-sonnet-4-6", undefined), "auto-ro-claude-sonnet-4-6");
});

Deno.test("buildModelMap: FALLBACK grouped -> 16 auto-ro/rw ids with variants", async () => {
  const grouped = groupBases(FALLBACK_MODELS);
  const map = buildModelMap(grouped);
  // 8 bases * 2 profiles = 16 ids
  assertEquals(Object.keys(map).length, 16);
  // picker for gemini-3.7-flash should show high/medium/low
  const m = map["auto-ro-gemini-3.7-flash"] as unknown as { variants: Record<string, unknown> };
  assertEquals(Object.keys(m.variants).sort(), ["high", "low", "medium"]);
  // picker for gemini-3.8-flash should show high/medium/low
  const m38 = map["auto-ro-gemini-3.8-flash"] as unknown as { variants: Record<string, unknown> };
  assertEquals(Object.keys(m38.variants).sort(), ["high", "low", "medium"]);
  // singleton has no variants
  const singleton = map["auto-ro-claude-sonnet-4-6"] as unknown as { variants: Record<string, unknown> };
  assertEquals(Object.keys(singleton.variants).length, 0);
  // ensure no bare ids leaked
  for (const id of Object.keys(map)) {
    const bare = id.startsWith("gemini-") || id.startsWith("claude-") || id.startsWith("gpt-");
    assertEquals(bare, false);
  }
});

Deno.test("parity: plugin groupBases equals helpers groupBases on FALLBACK_MODELS", () => {
  const pluginGrouped = pluginGroupBases(FALLBACK_MODELS);
  const helperGrouped = groupBases(FALLBACK_MODELS);
  assertEquals(pluginGrouped.size, helperGrouped.size);
  for (const [k, v] of helperGrouped.entries()) {
    assertEquals(pluginGrouped.get(k), v);
  }
  assertEquals(buildModelMap(pluginGrouped), buildModelMap(helperGrouped));
});

Deno.test("parity: plugin groupBases equals helpers groupBases on dynamic multi-pass cases", () => {
  const testSlugs = [
    "gemini-3.8-flash-high",
    "gemini-3.8-flash-ultra",
    "gemini-3.9-pro-max",
    "gemini-3.9-pro-ultra",
    "singleton-model",
  ];
  const pluginGrouped = pluginGroupBases(testSlugs);
  const helperGrouped = groupBases(testSlugs);
  assertEquals(pluginGrouped.size, helperGrouped.size);
  for (const [k, v] of helperGrouped.entries()) {
    assertEquals(pluginGrouped.get(k), v);
  }
  assertEquals(buildModelMap(pluginGrouped), buildModelMap(helperGrouped));
});

Deno.test("groupBases: gemini-3.1-pro-high/low -> {high,low} subset", () => {
  const grouped = groupBases(["gemini-3.1-pro-high", "gemini-3.1-pro-low"]);
  assertEquals(grouped.get("gemini-3.1-pro"), new Set(["high", "low"]));
});

Deno.test("stripEffortSuffix: low suffix stripped", () => {
  const r = stripEffortSuffix("gemini-3.1-pro-low");
  assertEquals(r.base, "gemini-3.1-pro");
  assertEquals(r.variant, "low");
});

Deno.test("provider hook fallback: returns grouped models when bridge unreachable", async () => {
  const mod = await import("./agy-bridge.ts");
  const plugin = mod.default;
  // minimal input stub
  const hooks = await plugin({} as unknown as Parameters<typeof plugin>[0]);
  // provider hook should exist
  assertEquals(typeof hooks.provider?.id, "string");
  assertEquals(hooks.provider?.id, "agy-bridge");
  // call models with no auth (fallback)
  const models = await hooks.provider!.models!({} as any, {});
  // should contain auto-ro-* entries only, no bare
  const ids = Object.keys(models);
  const hasBare = ids.some((id) => !id.startsWith("auto-ro-") && !id.startsWith("auto-rw-"));
  assertEquals(hasBare, false);
  // should contain 16 ids
  assertEquals(ids.length, 16);
  // should contain expected bases
  assertEquals(ids.includes("auto-ro-gemini-3.7-flash"), true);
  assertEquals(ids.includes("auto-rw-gemini-3.7-flash"), true);
  assertEquals(ids.includes("auto-ro-gemini-3.8-flash"), true);
  assertEquals(ids.includes("auto-rw-gemini-3.8-flash"), true);
});

Deno.test("fetch wrapper: variant maps to suffixed wire model (unit via wireModel)", () => {
  // fetch wrapper logic is exercised via wireModel: variant present -> suffixed
  assertEquals(wireModel("auto-ro-gemini-3.7-flash", "medium"), "auto-ro-gemini-3.7-flash-medium");
  // no variant -> verbatim ensures no bare ids
  assertEquals(wireModel("auto-rw-claude-opus-4-6", undefined), "auto-rw-claude-opus-4-6");
});

// --- Enriched reasoning metadata (strict TDD — RED before GREEN) ---

Deno.test("buildModelMap: enriched shape — variants.*.reasoningEffort == key", () => {
  const grouped = groupBases(FALLBACK_MODELS);
  const map = buildModelMap(grouped);
  // every variant value must be { reasoningEffort: key }
  for (const [id, def] of Object.entries(map)) {
    const m = def as unknown as { variants: Record<string, unknown>; capabilities?: unknown };
    for (const k of Object.keys(m.variants)) {
      const v = m.variants[k] as Record<string, unknown>;
      assertEquals(v["reasoningEffort"], k, `${id} variant ${k} reasoningEffort`);
    }
  }
  // spot-check gemini-3.7-flash
  const gemini = map["auto-rw-gemini-3.7-flash"] as unknown as { variants: Record<string, { reasoningEffort: string }> };
  assertEquals(gemini.variants.high.reasoningEffort, "high");
  assertEquals(gemini.variants.medium.reasoningEffort, "medium");
  assertEquals(gemini.variants.low.reasoningEffort, "low");
});

Deno.test("buildModelMap: capabilities.reasoning true iff variants non-empty", () => {
  const grouped = groupBases(FALLBACK_MODELS);
  const map = buildModelMap(grouped);
  const singleton = map["auto-ro-claude-sonnet-4-6"] as unknown as { capabilities?: { reasoning?: boolean }; variants: Record<string, unknown> };
  // singleton must NOT advertise reasoning
  assertEquals(singleton.capabilities?.reasoning, undefined);
  assertEquals(Object.keys(singleton.variants).length, 0);
  // non-singletons must advertise reasoning:true
  const gemini = map["auto-ro-gemini-3.7-flash"] as unknown as { capabilities?: { reasoning?: boolean } };
  assertEquals(gemini.capabilities?.reasoning, true);
  const opus = map["auto-ro-claude-opus-4-6"] as unknown as { capabilities?: { reasoning?: boolean }; variants: Record<string, unknown> };
  assertEquals(opus.capabilities?.reasoning, true);
  assertEquals(Object.keys(opus.variants), ["thinking"]);
});

Deno.test("buildModelMap: thinking variant enriched", () => {
  const grouped = groupBases(FALLBACK_MODELS);
  const map = buildModelMap(grouped);
  const opus = map["auto-rw-claude-opus-4-6"] as unknown as { variants: Record<string, { reasoningEffort: string }> };
  assertEquals(opus.variants.thinking.reasoningEffort, "thinking");
});

Deno.test("buildModelMap: regression — gpt-oss singleton-like medium is selectable", () => {
  const grouped = groupBases(FALLBACK_MODELS);
  const map = buildModelMap(grouped);
  const gpt = map["auto-rw-gpt-oss-120b"] as unknown as { capabilities?: { reasoning?: boolean }; variants: Record<string, { reasoningEffort: string }> };
  assertEquals(gpt.capabilities?.reasoning, true);
  assertEquals(gpt.variants.medium.reasoningEffort, "medium");
});

Deno.test("buildModelMap: all non-singleton variants reasoningEffort coverage (triangulate)", () => {
  const grouped = groupBases(FALLBACK_MODELS);
  const map = buildModelMap(grouped);
  // gpt-oss-120b and gemini-3.1-pro also covered
  const pro = map["auto-ro-gemini-3.1-pro"] as unknown as { variants: Record<string, { reasoningEffort: string }> };
  assertEquals(pro.variants.high.reasoningEffort, "high");
  assertEquals(pro.variants.low.reasoningEffort, "low");
  // rw variants must mirror ro
  const proRw = map["auto-rw-gemini-3.1-pro"] as unknown as { variants: Record<string, { reasoningEffort: string }> };
  assertEquals(proRw.variants.high.reasoningEffort, "high");
});
