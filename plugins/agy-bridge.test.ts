// RED test for bridge-effort-reasoning-exposure
// Must fail before implementation (2.1) and pass after — strict TDD.
import { assertEquals } from "jsr:@std/assert";
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
