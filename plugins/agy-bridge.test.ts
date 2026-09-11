// RED test for bridge-effort-reasoning-exposure
// Must fail before implementation (2.1) and pass after — strict TDD.
import { assertEquals } from "@std/assert";
import {
  stripEffortSuffix,
  groupBases,
  wireModel,
  FALLBACK_MODELS,
  buildModelMap,
  createNoteClassifier,
  classifyLine,
  type DeltaKind,
  NARRATION_SUFFIX,
  applyNarrationSuffix,
} from "./agy-bridge-helpers.ts";

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

Deno.test("groupBases: 14 FALLBACK → 7 bases with variant subsets (live-verified 2026-09-07)", () => {
  const grouped = groupBases(FALLBACK_MODELS);
  // Should dedupe to 7 distinct bases (14 slugs, live-verified 2026-09-07)
  assertEquals(grouped.size, 7);
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

Deno.test("buildModelMap: FALLBACK grouped -> 14 auto-ro/rw ids with variants", () => {
  const grouped = groupBases(FALLBACK_MODELS);
  const map = buildModelMap(grouped);
  // 7 bases * 2 profiles = 14 ids (live-verified 2026-09-07)
  assertEquals(Object.keys(map).length, 14);
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
  const models = await hooks.provider!.models!({} as unknown as Record<string, unknown>, {});
  // should contain auto-ro-* entries only, no bare
  const ids = Object.keys(models);
  const hasBare = ids.some((id) => !id.startsWith("auto-ro-") && !id.startsWith("auto-rw-"));
  assertEquals(hasBare, false);
  // should contain 14 ids (live-verified 2026-09-07)
  assertEquals(ids.length, 14);
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

Deno.test("buildModelMap: enriched shape — reasoningEffort == key except thinking maps to max", () => {
  const grouped = groupBases(FALLBACK_MODELS);
  const map = buildModelMap(grouped);
  // every ENABLED variant value must be { reasoningEffort: key }, except the
  // thinking Map disposition: opencode's enum has no "thinking" member
  // (spike obs #101), so it is advertised as reasoningEffort "max".
  // Masked (disabled) entries carry no reasoningEffort by contract (v4).
  for (const [id, def] of Object.entries(map)) {
    const m = def as unknown as { variants: Record<string, unknown>; capabilities?: unknown };
    for (const k of Object.keys(m.variants)) {
      const v = m.variants[k] as Record<string, unknown>;
      if (v["disabled"] === true) {
        assertEquals(v, { disabled: true }, `${id} masked variant ${k}`);
        continue;
      }
      assertEquals(
        v["reasoningEffort"],
        k === "thinking" ? "max" : k,
        `${id} variant ${k} reasoningEffort`,
      );
    }
  }
  // spot-check gemini-3.7-flash
  const gemini = map["auto-rw-gemini-3.7-flash"] as unknown as { variants: Record<string, { reasoningEffort: string }> };
  assertEquals(gemini.variants.high.reasoningEffort, "high");
  assertEquals(gemini.variants.medium.reasoningEffort, "medium");
  assertEquals(gemini.variants.low.reasoningEffort, "low");
});

Deno.test("buildModelMap: reasoning true iff variants non-empty", () => {
  const grouped = groupBases(FALLBACK_MODELS);
  const map = buildModelMap(grouped);
  const singleton = map["auto-ro-claude-sonnet-4-6"] as unknown as { reasoning?: boolean; capabilities?: unknown; variants: Record<string, unknown> };
  // singleton must NOT advertise reasoning
  assertEquals(singleton.reasoning, undefined);
  assertEquals(singleton.capabilities, undefined);
  assertEquals(Object.keys(singleton.variants).length, 0);
  // non-singletons must advertise reasoning:true
  const gemini = map["auto-ro-gemini-3.7-flash"] as unknown as { reasoning?: boolean; capabilities?: unknown };
  assertEquals(gemini.reasoning, true);
  assertEquals(gemini.capabilities, undefined);
  const opus = map["auto-ro-claude-opus-4-6"] as unknown as { reasoning?: boolean; capabilities?: unknown; variants: Record<string, unknown> };
  assertEquals(opus.reasoning, true);
  assertEquals(opus.capabilities, undefined);
  // v4 masking: declared thinking stays enabled; undeclared generics masked.
  assertEquals(opus.variants["thinking"], { reasoningEffort: "max" });
  assertEquals(opus.variants["high"], { disabled: true });
  assertEquals(opus.variants["medium"], { disabled: true });
  assertEquals(opus.variants["low"], { disabled: true });
});

Deno.test("buildModelMap: thinking variant enriched maps to reasoningEffort max", () => {
  const grouped = groupBases(FALLBACK_MODELS);
  const map = buildModelMap(grouped);
  const opus = map["auto-rw-claude-opus-4-6"] as unknown as { variants: Record<string, { reasoningEffort: string }> };
  assertEquals(opus.variants.thinking.reasoningEffort, "max");
});

Deno.test("buildModelMap: regression — gpt-oss singleton-like medium is selectable", () => {
  const grouped = groupBases(FALLBACK_MODELS);
  const map = buildModelMap(grouped);
  const gpt = map["auto-rw-gpt-oss-120b"] as unknown as { reasoning?: boolean; capabilities?: unknown; variants: Record<string, { reasoningEffort: string }> };
  assertEquals(gpt.reasoning, true);
  assertEquals(gpt.capabilities, undefined);
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

// --- Streaming delta messages (bridge-live-thoughts: DeltaKind routing) ---

Deno.test("delta streaming: createNoteClassifier routes by kind and handles lines", () => {
  const chunks: Array<Record<string, unknown>> = [];
  const log = { delta_chars: 0 };
  const classifier = createNoteClassifier({
    chunk: (delta: Record<string, unknown>) => chunks.push(delta),
    log,
  });

  classifier.onDelta("thought", "thinking about life\n");
  classifier.onDelta("agent_response", "The answer is 42.\n");

  assertEquals(log.delta_chars, "thinking about life\n".length + "The answer is 42.\n".length);
  assertEquals(chunks.length, 2);
  assertEquals(chunks[0], { reasoning_content: "thinking about life\n" });
  assertEquals(chunks[1], { content: "The answer is 42.\n" });
});

Deno.test("delta streaming: empty-skip — empty text_delta never calls chunk", () => {
  const chunks: Array<Record<string, unknown>> = [];
  const log = { delta_chars: 0 };
  const classifier = createNoteClassifier({
    chunk: (delta: Record<string, unknown>) => chunks.push(delta),
    log,
  });

  // Test explicitly with empty string — chunk never called, delta_chars unchanged
  classifier.onDelta("thought", "");
  classifier.onDelta("agent_response", "");
  assertEquals(chunks.length, 0);
  assertEquals(log.delta_chars, 0);

  // Triangulate with non-empty string to ensure chunk IS called for real input
  classifier.onDelta("thought", "step 1");
  assertEquals(chunks.length, 1);
  assertEquals(chunks[0], { reasoning_content: "step 1" });
});

Deno.test("delta streaming: unknown step logs via console.error and routes to reasoning_content", () => {
  const originalError = console.error;
  const loggedErrors: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    loggedErrors.push(args);
  };

  try {
    const su = { step_type: "custom_future_step", text_delta: "some internal state" };
    let capturedKind: DeltaKind | null = null;
    let capturedText: string | null = null;

    // Simulate runAgy filter logic for step_update
    if (typeof su.text_delta === "string" && su.text_delta !== "") {
      let kind: DeltaKind;
      if (su.step_type === "agent_response") {
        kind = "agent_response";
      } else if (su.step_type === "thought") {
        kind = "thought";
      } else if (su.step_type === "tool") {
        kind = "tool";
      } else {
        kind = "unknown";
        console.error("unknown step_type:", su.step_type, su);
      }
      capturedKind = kind;
      capturedText = su.text_delta;
    }

    assertEquals(capturedKind, "unknown");
    assertEquals(capturedText, "some internal state");
    assertEquals(loggedErrors.length, 1);
    assertEquals(loggedErrors[0][0], "unknown step_type:");
    assertEquals(loggedErrors[0][1], "custom_future_step");

    // Ensure unknown routes to reasoning_content
    const chunks: Array<Record<string, unknown>> = [];
    const classifier = createNoteClassifier({
      chunk: (delta: Record<string, unknown>) => chunks.push(delta),
    });
    classifier.onDelta(capturedKind!, capturedText!);
    assertEquals(chunks.length, 1);
    assertEquals(chunks[0], { reasoning_content: "some internal state" });
  } finally {
    console.error = originalError;
  }
});

Deno.test("delta streaming: autonomous — no duplicate chunk({content: r.text}) after live deltas", () => {
  const chunks: Array<Record<string, unknown>> = [];
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) => {
    chunks.push({ delta, finish });
  };
  const log = { delta_chars: 0 };

  const onDelta = (kind: DeltaKind, d: string) => {
    if (!d) return;
    log.delta_chars += d.length;
    if (kind === "agent_response") {
      chunk({ content: d });
    } else {
      chunk({ reasoning_content: d });
    }
  };

  // 1. Initial role
  chunk({ role: "assistant" });
  // 2. Thought delta
  onDelta("thought", "Calculating...");
  // 3. Answer deltas
  onDelta("agent_response", "The answer ");
  onDelta("agent_response", "is 42.");
  // 4. Final stop chunk (NO chunk({ content: r.text }) duplicate dump)
  chunk({}, "stop");

  assertEquals(chunks.length, 5);
  assertEquals(chunks[0], { delta: { role: "assistant" }, finish: null });
  assertEquals(chunks[1], { delta: { reasoning_content: "Calculating..." }, finish: null });
  assertEquals(chunks[2], { delta: { content: "The answer " }, finish: null });
  assertEquals(chunks[3], { delta: { content: "is 42." }, finish: null });
  assertEquals(chunks[4], { delta: {}, finish: "stop" });

  // Verify no chunk ever had the full text replayed in content
  const contentChunks = chunks.filter((c) => (c.delta as Record<string, unknown>).content !== undefined);
  assertEquals(contentChunks.length, 2);
  const fullContentReplay = chunks.find((c) => (c.delta as Record<string, unknown>).content === "The answer is 42.");
  assertEquals(fullContentReplay, undefined);
});

Deno.test("delta streaming: tool-loop — live content display-only, final parseToolCalls still correct when tags split", () => {
  const chunks: Array<Record<string, unknown>> = [];
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) => {
    chunks.push({ delta, finish });
  };
  const log = { delta_chars: 0 };

  const onDelta = (kind: DeltaKind, d: string) => {
    if (!d) return;
    log.delta_chars += d.length;
    if (kind === "agent_response") {
      chunk({ content: d });
    } else {
      chunk({ reasoning_content: d });
    }
  };

  // Emit reasoning delta
  onDelta("thought", "Let me look up the weather.");
  // Split tool call tags across live agent_response deltas
  onDelta("agent_response", "Checking now: <tool_call>");
  onDelta("agent_response", '{"name":"get_weather",');
  onDelta("agent_response", '"arguments":{"city":"London"}}');
  onDelta("agent_response", "</tool_call>");

  // Full response text reconstructed by agy
  const toolResponseText = 'Checking now: <tool_call>{"name":"get_weather","arguments":{"city":"London"}}</tool_call>';

  // parseToolCalls on final r.text
  const TOOL_CALL_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  const tool_calls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];
  let content = "";
  let last = 0;
  for (const m of toolResponseText.matchAll(TOOL_CALL_RE)) {
    content += toolResponseText.slice(last, m.index);
    last = m.index! + m[0].length;
    const parsed = JSON.parse(m[1].trim());
    tool_calls.push({
      id: `call_${tool_calls.length + 1}`,
      type: "function",
      function: { name: parsed.name, arguments: JSON.stringify(parsed.arguments) },
    });
  }
  content += toolResponseText.slice(last);

  // In bridge-live-thoughts tool-loop handler:
  if (tool_calls.length) {
    chunk({ role: "assistant", tool_calls }, "tool_calls");
  } else {
    chunk({}, "stop");
  }

  assertEquals(chunks.length, 6);
  assertEquals(chunks[0], { delta: { reasoning_content: "Let me look up the weather." }, finish: null });
  assertEquals(chunks[1], { delta: { content: "Checking now: <tool_call>" }, finish: null });
  assertEquals(chunks[2], { delta: { content: '{"name":"get_weather",' }, finish: null });
  assertEquals(chunks[3], { delta: { content: '"arguments":{"city":"London"}}' }, finish: null });
  assertEquals(chunks[4], { delta: { content: "</tool_call>" }, finish: null });
  assertEquals(chunks[5].finish, "tool_calls");
  const finalDelta = chunks[5].delta as { tool_calls: Array<{ function: { name: string } }> };
  assertEquals(finalDelta.tool_calls.length, 1);
  assertEquals(finalDelta.tool_calls[0].function.name, "get_weather");
});

Deno.test("delta streaming: delta_chars sums across both kinds", () => {
  const log = { delta_chars: 0 };
  const classifier = createNoteClassifier({
    chunk: () => {},
    log,
  });

  classifier.onDelta("thought", "thought 123"); // 11
  classifier.onDelta("agent_response", "resp 4567\n"); // 10
  classifier.onDelta("tool", "tool 89"); // 7

  assertEquals(log.delta_chars, 11 + 10 + 7);
});

Deno.test("delta streaming: tool-loop keepalive sends : keepalive comments when stalled", async () => {
  const rawSent: string[] = [];
  const sendRaw = (s: string) => rawSent.push(s);

  // Interval simulation with 10ms for fast test (production uses 10_000ms)
  const intervalMs = 10;
  const ka = setInterval(() => sendRaw(`: keepalive ${Date.now()}\n\n`), intervalMs);

  await new Promise((resolve) => setTimeout(resolve, 35));
  clearInterval(ka);

  // At least 2 keepalives should have been sent
  assertEquals(rawSent.length >= 2, true, `Expected >= 2 keepalives, got ${rawSent.length}`);
  for (const s of rawSent) {
    assertEquals(s.startsWith(": keepalive "), true);
  }
});

// --- Phase 6: Narration disclosure (strict TDD — RED before GREEN) ---

Deno.test("narration: autonomous stream:true prompt contains NOTE: suffix", () => {
  const base = "# Conversation transcript\n\nDo the thing.";
  const streamingPrompt = applyNarrationSuffix(base, true);
  assertEquals(streamingPrompt.startsWith(base), true);
  assertEquals(streamingPrompt.includes("NOTE:"), true);
  assertEquals(streamingPrompt.includes(NARRATION_SUFFIX), true);
});

Deno.test("narration: stream:false prompt is verbatim without NOTE:", () => {
  const base = "# Conversation transcript\n\nDo the thing.";
  assertEquals(applyNarrationSuffix(base, false), base);
  assertEquals(applyNarrationSuffix(base, false).includes("NOTE:"), false);
});

Deno.test("narration: non-auto prompts never receive the suffix", () => {
  // Non-auto paths (renderPrompt/preparePrompt) never call
  // applyNarrationSuffix — they pass prompts through unmodified, which is
  // exactly the stream:false contract: verbatim output, no NOTE:.
  const nonAutoPrompt = "# System instructions\n\nBe helpful.\n\n# Conversation transcript\n\nHi.";
  assertEquals(applyNarrationSuffix(nonAutoPrompt, false), nonAutoPrompt);
  assertEquals(NARRATION_SUFFIX.includes("NOTE:"), true);
});

// --- Phase 1: Classifier helper (strict TDD — RED before GREEN) ---

Deno.test("1.1 RED test: NOTE line split across deltas → reasoning_content", () => {
  const chunks: Array<Record<string, unknown>> = [];
  const classifier = createNoteClassifier({
    chunk: (delta: Record<string, unknown>) => chunks.push(delta),
  });

  // Emitting a NOTE: line in chunks
  classifier.onDelta("agent_response", "NO");
  classifier.onDelta("agent_response", "TE: Checking");
  classifier.onDelta("agent_response", " the file status.\n");

  assertEquals(chunks.length, 1);
  assertEquals(chunks[0], { reasoning_content: "NOTE: Checking the file status.\n" });
});

Deno.test("1.2 RED test: NOTE→reasoning then answer→content; turn-end flush() residual→content", () => {
  const chunks: Array<Record<string, unknown>> = [];
  const classifier = createNoteClassifier({
    chunk: (delta: Record<string, unknown>) => chunks.push(delta),
  });

  // 1. NOTE line completes
  classifier.onDelta("agent_response", "NOTE: Running verification.\n");
  // 2. Direct answer line completes
  classifier.onDelta("agent_response", "All tests passed successfully.\n");
  // 3. Trailing residual without trailing newline
  classifier.onDelta("agent_response", "Done.");

  assertEquals(chunks.length, 2);
  assertEquals(chunks[0], { reasoning_content: "NOTE: Running verification.\n" });
  assertEquals(chunks[1], { content: "All tests passed successfully.\n" });

  // 4. flush() at turn end
  classifier.flush();
  assertEquals(chunks.length, 3);
  assertEquals(chunks[2], { content: "Done." });
});

Deno.test("1.3 RED test: identical chunk sequence via shared classifier across all paths", () => {
  const runSequence = () => {
    const chunks: Array<Record<string, unknown>> = [];
    const classifier = createNoteClassifier({
      chunk: (delta: Record<string, unknown>) => chunks.push(delta),
    });
    classifier.onDelta("thought", "internal thought ");
    classifier.onDelta("thought", "continued\n");
    classifier.onDelta("tool", "calling grep\n");
    classifier.onDelta("agent_response", "NOTE: step 1\n");
    classifier.onDelta("agent_response", "Hello ");
    classifier.onDelta("agent_response", "world.");
    classifier.flush();
    return chunks;
  };

  const path1 = runSequence();
  const path2 = runSequence();
  const path3 = runSequence();

  assertEquals(path1, path2);
  assertEquals(path2, path3);
  assertEquals(path1.length, 5);
  assertEquals(path1[0], { reasoning_content: "internal thought " });
  assertEquals(path1[1], { reasoning_content: "continued\n" });
  assertEquals(path1[2], { reasoning_content: "calling grep\n" });
  assertEquals(path1[3], { reasoning_content: "NOTE: step 1\n" });
  assertEquals(path1[4], { content: "Hello world." });
});

Deno.test("1.4 classifyLine pure function: identifies NOTE: prefix and whitespace variations", () => {
  assertEquals(classifyLine("NOTE: hello\n"), "reasoning_content");
  assertEquals(classifyLine("   NOTE: indented note\n"), "reasoning_content");
  assertEquals(classifyLine("Not a note\n"), "content");
  assertEquals(classifyLine("NOTEworthy text\n"), "content");
  assertEquals(classifyLine("Here is the answer.\n"), "content");
});

Deno.test("1.4 triangulation: empty deltas skipped, delta_chars tracked, unknown step logged", () => {
  const chunks: Array<Record<string, unknown>> = [];
  const log = { delta_chars: 0 };
  const classifier = createNoteClassifier({
    chunk: (delta: Record<string, unknown>) => chunks.push(delta),
    log,
  });

  const origError = console.error;
  let logged = false;
  console.error = () => { logged = true; };
  try {
    classifier.onDelta("agent_response", "");
    classifier.onDelta("thought", "");
    assertEquals(chunks.length, 0);
    assertEquals(log.delta_chars, 0);

    // Triangulate leading whitespace on NOTE:
    classifier.onDelta("agent_response", "   NOTE: indented note line\n");
    assertEquals(chunks.length, 1);
    assertEquals(chunks[0], { reasoning_content: "   NOTE: indented note line\n" });

    // Triangulate unknown kind
    classifier.onDelta("unknown", "mystery delta");
    assertEquals(logged, true);
    assertEquals(chunks.length, 2);
    assertEquals(chunks[1], { reasoning_content: "mystery delta" });
    assertEquals(log.delta_chars > 0, true);
  } finally {
    console.error = origError;
  }
});

Deno.test("1.5 RED test: buildModelMap emits flat interleaved and reasoning: true, no nested capabilities", () => {
  const grouped = groupBases(FALLBACK_MODELS);
  const map = buildModelMap(grouped);

  // Check non-singleton: auto-ro-gemini-3.7-flash
  const flash = map["auto-ro-gemini-3.7-flash"] as Record<string, unknown>;
  assertEquals(flash.reasoning, true);
  assertEquals(flash.interleaved, { field: "reasoning_content" });
  assertEquals(flash.capabilities, undefined);

  // Check singleton: auto-ro-claude-sonnet-4-6
  const sonnet = map["auto-ro-claude-sonnet-4-6"] as Record<string, unknown>;
  assertEquals(sonnet.reasoning, undefined);
  assertEquals(sonnet.interleaved, undefined);
  assertEquals(sonnet.capabilities, undefined);
});

Deno.test("2.1 RED test: autonomous path routes via shared classifier with NOTE and flush", () => {
  const chunks: Array<Record<string, unknown>> = [];
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) => {
    chunks.push({ delta, finish });
  };
  const log = { delta_chars: 0 };
  const classifier = createNoteClassifier({
    chunk: (d) => chunk(d),
    log,
  });

  // 1. Initial role
  chunk({ role: "assistant" });
  // 2. Thought delta
  classifier.onDelta("thought", "Analyzing problem...");
  // 3. NOTE narration
  classifier.onDelta("agent_response", "NOTE: Searching for definitions.\n");
  // 4. Final answer text (without newline)
  classifier.onDelta("agent_response", "Here is the result.");
  // 5. Stream finalization: flush then stop
  classifier.flush();
  chunk({}, "stop");

  assertEquals(chunks.length, 5);
  assertEquals(chunks[0], { delta: { role: "assistant" }, finish: null });
  assertEquals(chunks[1], { delta: { reasoning_content: "Analyzing problem..." }, finish: null });
  assertEquals(chunks[2], { delta: { reasoning_content: "NOTE: Searching for definitions.\n" }, finish: null });
  assertEquals(chunks[3], { delta: { content: "Here is the result." }, finish: null });
  assertEquals(chunks[4], { delta: {}, finish: "stop" });
  assertEquals(log.delta_chars > 0, true);
});

Deno.test("3.2 RED parity: drift-guard test — plugin groupBases == helpers groupBases on same input", () => {
  const testInputs = [
    FALLBACK_MODELS,
    [
      "gemini-3.7-flash-high",
      "gemini-3.7-flash-low",
      "claude-sonnet-4-6",
      "gpt-oss-120b-medium",
      "gemini-3.8-flash-ultra",
      "gemini-3.9-pro-max",
      "gemini-3.9-pro-ultra",
      "standalone-model",
    ],
  ];

  for (const input of testInputs) {
    const fromPlugin = pluginGroupBases(input);
    const fromHelpers = groupBases(input);

    assertEquals(fromPlugin.size, fromHelpers.size);
    for (const [base, variants] of fromHelpers.entries()) {
      assertEquals(fromPlugin.has(base), true, `Plugin missing base: ${base}`);
      assertEquals(fromPlugin.get(base), variants, `Mismatch for base: ${base}`);
    }
  }
});

import denoConfig from "../deno.json" with { type: "json" };
import syncModelsSource from "../scripts/sync-models.ts" with { type: "text" };
import syncModelsTestSource from "../scripts/sync-models.test.ts" with { type: "text" };
import stubSource from "../stubs/opencode-plugin.ts" with { type: "text" };
import pluginSource from "./agy-bridge.ts" with { type: "text" };
import bridgeTestSource from "./agy-bridge.test.ts" with { type: "text" };
import installSource from "../install.sh" with { type: "text" };

Deno.test("Task 1.1 RED test: deno.json contains lint.exclude including openspec/changes/archive/**", () => {
  const config = denoConfig as { lint?: { exclude?: string[] } };
  assertEquals(Array.isArray(config.lint?.exclude), true, "lint.exclude must be an array");
  assertEquals(config.lint?.exclude?.includes("openspec/changes/archive/**"), true, "lint.exclude must include openspec/changes/archive/**");
});

Deno.test("Task 1.1 RED test: deno.json contains fmt.exclude including openspec/changes/archive/**", () => {
  const config = denoConfig as { fmt?: { exclude?: string[] } };
  assertEquals(Array.isArray(config.fmt?.exclude), true, "fmt.exclude must be an array");
  assertEquals(config.fmt?.exclude?.includes("openspec/changes/archive/**"), true, "fmt.exclude must include openspec/changes/archive/**");
});

Deno.test("Task 2.1 RED test: unused imports removed from scripts/sync-models.ts and sync-models.test.ts", () => {
  assertEquals(syncModelsSource.includes("stripEffortSuffix"), false, "scripts/sync-models.ts should not import stripEffortSuffix");
  assertEquals(syncModelsTestSource.includes("stripEffortSuffix,"), false, "scripts/sync-models.test.ts should not import unused stripEffortSuffix");
  assertEquals(syncModelsTestSource.includes("EFFORT_SUFFIXES,"), false, "scripts/sync-models.test.ts should not import unused EFFORT_SUFFIXES");
  assertEquals(syncModelsTestSource.includes("getDefaultConfigPath,"), false, "scripts/sync-models.test.ts should not import unused getDefaultConfigPath");
});

Deno.test("Task 2.2 RED test: stubs/opencode-plugin.ts and plugins/agy-bridge.ts have no raw 'any' or empty catch blocks", () => {
  assertEquals(stubSource.includes(": any"), false, "stubs/opencode-plugin.ts must not contain ': any'");
  assertEquals(pluginSource.includes("catch {}"), false, "plugins/agy-bridge.ts must not have empty 'catch {}' blocks without comment or handling");
  assertEquals(syncModelsSource.includes("Record<string, any>"), false, "scripts/sync-models.ts must not use Record<string, any>");
});

Deno.test("Task 1.2 RED test: plugins/agy-bridge.test.ts uses deno.json bare specifier for assertions", () => {
  const inlineSpecifier = "jsr" + ":@std/assert";
  assertEquals(bridgeTestSource.includes(`from "${inlineSpecifier}"`), false, "plugins/agy-bridge.test.ts should not use inline jsr specifiers");
});

Deno.test("Task 4.2 RED test: install.sh requires command -v deno and deno --version gate before proceeding", () => {
  assertEquals(installSource.includes("command -v deno"), true, "install.sh must check command -v deno");
  assertEquals(installSource.includes("deno --version"), true, "install.sh must check deno --version");
});

Deno.test("Task 4.3 RED test: install.sh removes inline Python 4-pass generator and dead PLUGIN_HELPERS_* vars", () => {
  assertEquals(installSource.includes("PLUGIN_HELPERS_SRC"), false, "install.sh must remove dead PLUGIN_HELPERS_SRC");
  assertEquals(installSource.includes("PLUGIN_HELPERS_DEST"), false, "install.sh must remove dead PLUGIN_HELPERS_DEST");
  assertEquals(installSource.includes("LOCKSTEP:plugin-4pass-live"), false, "install.sh must remove Python 4-pass generator");
  assertEquals(installSource.includes("Generated {len(models)} fallback models via Python"), false, "install.sh must not generate fallback models via Python");
});

Deno.test("Task 4.4 RED test: install.sh exits 1 on sync failure without Python fallback", () => {
  assertEquals(installSource.includes("attempting Python fallback"), false, "install.sh must not attempt Python fallback on sync failure");
});

import readmeSource from "../README.md" with { type: "text" };
import agyBridgeSource from "../agy-bridge.ts" with { type: "text" };
import openCodeProviderSpec from "../openspec/specs/opencode-provider/spec.md" with { type: "text" };

Deno.test("Task 5.1 RED test: README reflects Deno prerequisite, bundle workflow, and verified 7 bases / 14 ids", () => {
  // Python wording at L43 should not mention model fallback
  assertEquals(readmeSource.includes("como fallback de modelos si Deno no estuviera disponible"), false, "README must not claim Python is a model fallback");
  // Bundle workflow: plugin installation in manual steps should only copy agy-bridge.ts (bundle), not helpers
  assertEquals(readmeSource.includes("cp plugins/agy-bridge-helpers.ts ~/.config/opencode/plugins/agy-bridge-helpers.ts"), false, "README manual install should not copy agy-bridge-helpers.ts (bundle is self-contained)");
  // Bundle workflow mentioned
  assertEquals(readmeSource.includes("deno task bundle:plugin"), true, "README must mention bundle:plugin workflow");
  // 7 bases and 14 ids verified contract (live-verified 2026-09-07)
  assertEquals(readmeSource.includes("7 bases × 2 perfiles = 14 ids"), true, "README must state 7 bases × 2 perfiles = 14 ids");
  // Streaming in README updated (not claiming deltas intermedios no garantizan igualar al final)
  assertEquals(readmeSource.includes("deltas intermedios no garantizan igualar al final con tools nativas"), false, "README must not have stale streaming claim");
});

Deno.test("Task 5.2 RED test: agy-bridge.ts streaming comments reflect live deltas via classifier without stale claims", () => {
  // Check that agy-bridge.ts does not contain stale one-chunk comments or claim deltas are not guaranteed
  assertEquals(agyBridgeSource.includes("deliver the final text in one chunk"), false, "agy-bridge.ts must not mention delivering final text in one chunk");
  assertEquals(agyBridgeSource.includes("are NOT guaranteed to equal the final"), false, "agy-bridge.ts must not claim deltas are not guaranteed to equal final");
});

Deno.test("Task 5.3 RED test: install.sh and tests state verified 7/14 contract without stale '14 default models'", () => {
  assertEquals(installSource.includes("14 default models"), false, "install.sh must not mention '14 default models'");
});

Deno.test("Task 5.4 RED test: opencode-provider active spec and FALLBACK_MODELS conform to verified 7 bases / 14 ids", () => {
  const bases = groupBases(FALLBACK_MODELS);
  assertEquals(bases.size, 7, "FALLBACK_MODELS must yield exactly 7 bases");
  const modelMap = buildModelMap(bases);
  assertEquals(Object.keys(modelMap).length, 14, "buildModelMap must yield exactly 14 models");
  assertEquals(openCodeProviderSpec.includes("yields 8 bases"), false, "openspec/specs/opencode-provider/spec.md must not state 8 bases");
  assertEquals(openCodeProviderSpec.includes("yields 7 bases"), true, "openspec/specs/opencode-provider/spec.md must state 7 bases");
});

// --- agy-bridge-model-effort-regression Phase 2: strict resolveWireModel ---
// Fail-closed server validator. Pure function over the declared map; the
// bridge wires it to live modelSlugs in handleChat (see agy-bridge.ts).

import { resolveWireModel } from "./agy-bridge-helpers.ts";

function declaredMap(): Map<string, Set<string>> {
  return groupBases(FALLBACK_MODELS);
}

Deno.test("2.3 suffixed slug passes: auto-ro-gemini-3.7-flash-high resolves", () => {
  const r = resolveWireModel(
    "auto-ro-gemini-3.7-flash-high",
    [],
    declaredMap(),
  );
  assertEquals(r, { ok: true, slug: "gemini-3.7-flash-high" });
});

Deno.test("2.3 undeclared effort rejected: gemini-3.1-pro-medium 400s with available slugs", () => {
  const declared = declaredMap();
  const suffixed = resolveWireModel(
    "auto-ro-gemini-3.1-pro-medium",
    [],
    declared,
  );
  assertEquals(suffixed.ok, false);
  if (!suffixed.ok) {
    assertEquals(suffixed.message.includes('"medium"'), true);
    assertEquals(suffixed.message.includes("gemini-3.1-pro"), true);
    assertEquals(
      suffixed.message.includes("gemini-3.1-pro-high"),
      true,
      "400 must name available suffixed slugs",
    );
    assertEquals(suffixed.message.includes("gemini-3.1-pro-low"), true);
  }
  // Triangulate: bare base + undeclared effort signal also 400s, no fallback.
  const bare = resolveWireModel(
    "auto-ro-gemini-3.1-pro",
    ["medium"],
    declared,
  );
  assertEquals(bare.ok, false);
});

Deno.test("2.3 bare base with agreeing signal normalizes: gpt-oss + medium", () => {
  const r = resolveWireModel(
    "auto-ro-gpt-oss-120b",
    ["medium"],
    declaredMap(),
  );
  assertEquals(r, { ok: true, slug: "gpt-oss-120b-medium" });
});

Deno.test("2.3 bare base without signal 400s: auto-ro-gemini-3.7-flash names suffixed slugs", () => {
  const r = resolveWireModel(
    "auto-ro-gemini-3.7-flash",
    [],
    declaredMap(),
  );
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.message.includes("auto-ro-gemini-3.7-flash-high"), true);
    assertEquals(r.message.includes("auto-ro-gemini-3.7-flash-low"), true);
  }
});

Deno.test("2.3 singleton passes verbatim: auto-ro-claude-sonnet-4-6", () => {
  const r = resolveWireModel(
    "auto-ro-claude-sonnet-4-6",
    [],
    declaredMap(),
  );
  assertEquals(r, { ok: true, slug: "claude-sonnet-4-6" });
});

Deno.test("2.3 conflicting signals 400: suffix high + variant low", () => {
  const r = resolveWireModel(
    "auto-rw-gemini-3.7-flash-high",
    ["low"],
    declaredMap(),
  );
  assertEquals(r.ok, false);
});

// --- issue-8-variant-carrier Phase 2: array intake ---
// resolveWireModel(wire, signals[], declared): all present body signals
// (from variantSignals) are passed for consensus resolution. The slug
// suffix stays internal. Conflict messages use the prefixed-slug form.

Deno.test("issue-8 RED conflict: flat reasoning_effort high + variant low -> 400 naming suffixed slugs", () => {
  const r = resolveWireModel(
    "auto-ro-gemini-3.7-flash",
    ["high", "low"],
    declaredMap(),
  );
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(
      r.message.includes("auto-ro-gemini-3.7-flash-high"),
      true,
      "conflict message must name available slugs in prefixed form",
    );
    assertEquals(r.message.includes("auto-ro-gemini-3.7-flash-low"), true);
    assertEquals(r.message.includes("conflicting"), true);
  }
});

// --- issue-8-variant-carrier Phase 1: signal extraction ---
// Pure extraction of every accepted body signal for resolveWireModel.
// Accepted list (spec variant-carrier): flat reasoning_effort, nested
// reasoning.effort, variant. Slug suffix stays internal (wire parsing).
// Spike obs #101: opencode 1.18.29 sends flat reasoning_effort on /variant
// pick; NO options.* key on the wire — options are intentionally NOT read.

import { variantSignals } from "./agy-bridge-helpers.ts";

Deno.test("variantSignals: flat reasoning_effort is the primary signal (spike B')", () => {
  assertEquals(variantSignals({ reasoning_effort: "high" }), ["high"]);
});

Deno.test("variantSignals: nested reasoning.effort signal", () => {
  assertEquals(variantSignals({ reasoning: { effort: "low" } }), ["low"]);
});

Deno.test("variantSignals: variant signal", () => {
  assertEquals(variantSignals({ variant: "medium" }), ["medium"]);
});

Deno.test("variantSignals: multiple present signals all passed in fixed order", () => {
  assertEquals(
    variantSignals({ reasoning_effort: "high", variant: "high" }),
    ["high", "high"],
  );
  assertEquals(
    variantSignals({
      reasoning_effort: "high",
      reasoning: { effort: "high" },
      variant: "high",
    }),
    ["high", "high", "high"],
  );
});

Deno.test('variantSignals: filters empty string, "default" (opencode unset marker), and non-strings', () => {
  // Companion non-empty cases above prove the filter, not a trivial empty.
  assertEquals(variantSignals({}), []);
  assertEquals(variantSignals({ reasoning_effort: "" }), []);
  assertEquals(variantSignals({ reasoning_effort: "default" }), []);
  assertEquals(variantSignals({ reasoning: { effort: "default" } }), []);
  assertEquals(variantSignals({ variant: "default" }), []);
  assertEquals(
    variantSignals({ reasoning_effort: 5, variant: null, reasoning: "x" }),
    [],
  );
});

Deno.test("issue-8 nested signal composes: variantSignals(reasoning.effort) -> resolveWireModel", () => {
  const signals = variantSignals({ reasoning: { effort: "low" } });
  const r = resolveWireModel(
    "auto-ro-gemini-3.7-flash",
    signals,
    declaredMap(),
  );
  assertEquals(r, { ok: true, slug: "gemini-3.7-flash-low" });
});

Deno.test("issue-8 agreeing signals compose: flat + variant high -> suffixed slug (200)", () => {
  const signals = variantSignals({ reasoning_effort: "high", variant: "high" });
  const r = resolveWireModel(
    "auto-ro-gemini-3.7-flash",
    signals,
    declaredMap(),
  );
  assertEquals(r, { ok: true, slug: "gemini-3.7-flash-high" });
});

Deno.test("issue-8 unknown variant slug 400: undeclared suffix names base slugs only", () => {
  // "xhigh" is not a known effort suffix, so the slug is parsed as an
  // unknown base and rejected via the unknown-model path, whose available
  // list still names the base's declared suffixed slugs (spec: 400).
  const r = resolveWireModel(
    "auto-ro-gemini-3.7-flash-xhigh",
    [],
    declaredMap(),
  );
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.message.includes("unknown model"), true);
    assertEquals(r.message.includes("gemini-3.7-flash-high"), true);
    assertEquals(r.message.includes("gemini-3.7-flash-low"), true);
    assertEquals(r.message.includes("gemini-3.7-flash-medium"), true);
  }
});

// --- agy-bridge-model-effort-regression Phase 4: versioned cache ---
// MODEL_MAP_VERSION invalidates stale model-variants.json downstream.

import { MODEL_MAP_VERSION, GENERIC_EFFORTS } from "./agy-bridge-helpers.ts";

// --- issue-8-variant-carrier Phase 2b: thinking enum gap (Map disposition) ---
// Spike obs #101: "thinking" is NOT in opencode's reasoningEffort enum
// (["none","minimal","low","medium","high","xhigh","max"]). Chosen
// disposition (design): advertise thinking:{reasoningEffort:"max"} in
// buildModelMap, and apply a scoped reverse alias max→thinking in
// resolveWireModel only when "thinking" is a declared effort and "max"
// is not, so picker choices land on the -thinking slug.

Deno.test("issue-8 thinking map: buildModelMap advertises thinking with reasoningEffort max", () => {
  const map = buildModelMap(groupBases(FALLBACK_MODELS));
  const variants = map["auto-ro-claude-opus-4-6"] as {
    variants: Record<string, { reasoningEffort: string }>;
  };
  assertEquals(variants.variants["thinking"], { reasoningEffort: "max" });
});

Deno.test("issue-8 thinking alias: flat max resolves to -thinking slug when thinking declared", () => {
  const r = resolveWireModel(
    "auto-ro-claude-opus-4-6",
    ["max"],
    declaredMap(),
  );
  assertEquals(r, { ok: true, slug: "claude-opus-4-6-thinking" });
});

Deno.test("issue-8 thinking alias scoped: max stays unknown for bases without thinking", () => {
  const r = resolveWireModel(
    "auto-ro-gemini-3.7-flash",
    ["max"],
    declaredMap(),
  );
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.message.includes('"max"'), true);
  }
});

Deno.test("issue-8 thinking alias guard: max kept when base declares max itself", () => {
  const declared = new Map<string, Set<string>>([
    ["gpt-x", new Set(["max", "thinking"])],
  ]);
  const r = resolveWireModel("auto-ro-gpt-x", ["max"], declared);
  assertEquals(r, { ok: true, slug: "gpt-x-max" });
});

Deno.test("issue-8 thinking alias: suffix thinking + flat max agree via alias", () => {
  const r = resolveWireModel(
    "auto-rw-claude-opus-4-6-thinking",
    ["max"],
    declaredMap(),
  );
  assertEquals(r, { ok: true, slug: "claude-opus-4-6-thinking" });
});

Deno.test("4.1 MODEL_MAP_VERSION is 4 (masking contract invalidates v3 caches)", () => {
  assertEquals(MODEL_MAP_VERSION, 4);
});

Deno.test("4.3 installer purges stale model-variants.json before resync", () => {
  assertEquals(
    installSource.includes("model-variants.json"),
    true,
    "install.sh must invalidate the stale downstream cache",
  );
});

// --- modelo-agy-efforts-incorrectos Phase 2: explicit variant masking (strict TDD — RED before GREEN) ---
// Declared-truth contract (spec variant-masking): declared efforts stay
// {reasoningEffort}; generic-but-undeclared efforts are exactly
// {disabled:true}; every generic key is pre-populated; model-level
// reasoning_options carries declared truth (sorted); singletons untouched.

Deno.test("masking 2.1: declared efforts remain enabled with correct reasoningEffort", () => {
  const grouped = groupBases(["gemini-3.1-pro-high", "gemini-3.1-pro-low"]);
  const map = buildModelMap(grouped);
  const m = map["auto-ro-gemini-3.1-pro"] as unknown as {
    variants: Record<string, unknown>;
  };
  assertEquals(m.variants["high"], { reasoningEffort: "high" });
  assertEquals(m.variants["low"], { reasoningEffort: "low" });
});

Deno.test("masking 2.1: undeclared generic effort is exactly {disabled:true}", () => {
  const grouped = groupBases(["gemini-3.1-pro-high", "gemini-3.1-pro-low"]);
  const map = buildModelMap(grouped);
  const m = map["auto-ro-gemini-3.1-pro"] as unknown as {
    variants: Record<string, unknown>;
  };
  // Deep-equal on the whole entry: no reasoningEffort may leak into a mask.
  assertEquals(m.variants["medium"], { disabled: true });
});

Deno.test("masking 2.1: all generic effort keys pre-populated per reasoning model", () => {
  const grouped = groupBases(["gemini-3.1-pro-high", "gemini-3.1-pro-low"]);
  const map = buildModelMap(grouped);
  const m = map["auto-ro-gemini-3.1-pro"] as unknown as {
    variants: Record<string, unknown>;
  };
  const keys = Object.keys(m.variants);
  for (const g of ["high", "medium", "low"] as const) {
    assertEquals(keys.includes(g), true, `generic key ${g} must be present`);
  }
});

Deno.test("masking 2.1: reasoning_options lists only declared efforts, sorted", () => {
  const grouped = groupBases(["gemini-3.1-pro-high", "gemini-3.1-pro-low"]);
  const map = buildModelMap(grouped);
  const m = map["auto-ro-gemini-3.1-pro"] as unknown as {
    reasoning_options: unknown;
  };
  assertEquals(m.reasoning_options, ["high", "low"]);
});

Deno.test("masking 2.1: singletons untouched (no masking, no reasoning_options)", () => {
  const grouped = groupBases(FALLBACK_MODELS);
  const map = buildModelMap(grouped);
  const singleton = map["auto-ro-claude-sonnet-4-6"] as unknown as {
    variants: Record<string, unknown>;
    reasoning?: boolean;
    reasoning_options?: unknown;
  };
  assertEquals(Object.keys(singleton.variants).length, 0);
  assertEquals(singleton.reasoning, undefined);
  assertEquals(singleton.reasoning_options, undefined);
});

Deno.test("masking 2.1 triangulate: fully-declared model has no masks; rw mirrors ro", () => {
  const grouped = groupBases(FALLBACK_MODELS);
  const map = buildModelMap(grouped);
  // gemini-3.7-flash declares the full generic set: zero disabled entries.
  const flash = map["auto-ro-gemini-3.7-flash"] as unknown as {
    variants: Record<string, unknown>;
    reasoning_options: unknown;
  };
  assertEquals(flash.variants["high"], { reasoningEffort: "high" });
  assertEquals(flash.variants["medium"], { reasoningEffort: "medium" });
  assertEquals(flash.variants["low"], { reasoningEffort: "low" });
  assertEquals(flash.reasoning_options, ["high", "low", "medium"]);
  // rw profile mirrors ro exactly for a masked model.
  const proRo = map["auto-ro-gemini-3.1-pro"] as unknown as Record<string, unknown>;
  const proRw = map["auto-rw-gemini-3.1-pro"] as unknown as Record<string, unknown>;
  assertEquals(proRw["variants"], proRo["variants"]);
  assertEquals(proRw["reasoning_options"], proRo["reasoning_options"]);
});

Deno.test("masking 2.1 triangulate: thinking model masks generics, keeps max alias", () => {
  const grouped = groupBases(FALLBACK_MODELS);
  const map = buildModelMap(grouped);
  const opus = map["auto-ro-claude-opus-4-6"] as unknown as {
    variants: Record<string, unknown>;
    reasoning_options: unknown;
  };
  assertEquals(opus.variants["thinking"], { reasoningEffort: "max" });
  assertEquals(opus.variants["high"], { disabled: true });
  assertEquals(opus.variants["medium"], { disabled: true });
  assertEquals(opus.variants["low"], { disabled: true });
  assertEquals(opus.reasoning_options, ["thinking"]);
});

Deno.test("masking 2.2: GENERIC_EFFORTS is exactly [high, medium, low]", () => {
  assertEquals([...GENERIC_EFFORTS], ["high", "medium", "low"]);
});

