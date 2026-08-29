// RED test for custom-opencode-provider-agy-bridge
// Must fail before implementation (2.1) and pass after.
import { assertEquals } from "jsr:@std/assert";
import { stripEffortSuffix, groupBases, wireModel, FALLBACK_MODELS, buildModelMap } from "./agy-bridge-helpers.ts";

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

Deno.test("groupBases: 14 FALLBACK → 7 bases with variant subsets", () => {
  const grouped = groupBases(FALLBACK_MODELS);
  // Should dedupe to 7 distinct bases
  assertEquals(grouped.size, 7);
  const flash37 = grouped.get("gemini-3.7-flash");
  assertEquals(flash37, new Set(["high", "medium", "low"]));
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

Deno.test("buildModelMap: FALLBACK grouped -> 14 auto-ro/rw ids with variants", async () => {
  const grouped = groupBases(FALLBACK_MODELS);
  const map = buildModelMap(grouped);
  // 7 bases *2 profiles = 14 ids (documents actual grouping; spec mentions 28 flat but variant grouping reduces)
  assertEquals(Object.keys(map).length, 14);
  // picker for gemini-3.7-flash should show high/medium/low
  const m = map["auto-ro-gemini-3.7-flash"] as unknown as { variants: Record<string, unknown> };
  assertEquals(Object.keys(m.variants).sort(), ["high", "low", "medium"]);
  // singleton has no variants
  const singleton = map["auto-ro-claude-sonnet-4-6"] as unknown as { variants: Record<string, unknown> };
  assertEquals(Object.keys(singleton.variants).length, 0);
  // ensure no bare ids leaked
  for (const id of Object.keys(map)) {
    const bare = id.startsWith("gemini-") || id.startsWith("claude-") || id.startsWith("gpt-");
    assertEquals(bare, false);
  }
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
  // should contain expected base
  assertEquals(ids.includes("auto-ro-gemini-3.7-flash"), true);
  assertEquals(ids.includes("auto-rw-gemini-3.7-flash"), true);
});

Deno.test("fetch wrapper: variant maps to suffixed wire model (unit via wireModel)", () => {
  // fetch wrapper logic is exercised via wireModel: variant present -> suffixed
  assertEquals(wireModel("auto-ro-gemini-3.7-flash", "medium"), "auto-ro-gemini-3.7-flash-medium");
  // no variant -> verbatim ensures no bare ids
  assertEquals(wireModel("auto-rw-claude-opus-4-6", undefined), "auto-rw-claude-opus-4-6");
});
