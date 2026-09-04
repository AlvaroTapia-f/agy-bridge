// agy-bridge: local OpenAI-compatible server backed by the OFFICIAL Antigravity
// CLI (`agy`) in headless mode. Family-C integration: every request to Google
// is performed by the official binary with its own authentication.
//
// Anti-ban invariants (do not break these):
//   1. Only spawns ${AGY_BIN} (official agy). Never reads/copies auth tokens.
//   2. Never talks to Google endpoints directly; no OAuth of its own.
//   3. Single-account, single-concurrent-run by default (MAX_CONCURRENT=1).
//
// Run: deno run --allow-net --allow-run=$AGY_BIN \
//        --allow-write=$HOME/.local/state/agy-bridge agy-bridge.ts

// ---------- config ----------

const PORT = Number(Deno.env.get("PORT") ?? 7421);
const HOSTNAME = Deno.env.get("HOSTNAME") ?? "127.0.0.1";
const AGY_BIN = Deno.env.get("AGY_BIN") ?? "agy";
const AGY_AGENT = Deno.env.get("AGY_AGENT") ?? "raw";
const MAX_CONCURRENT = Math.max(1, Number(Deno.env.get("MAX_CONCURRENT") ?? 1));
const PRINT_TIMEOUT = Deno.env.get("PRINT_TIMEOUT") ?? "15m";
// Bridge-side backstop independent of agy honoring --print-timeout: hard
// deadline = print timeout + margin, then escalating SIGTERM→SIGKILL. The
// margin absorbs agy shutdown latency; overridable for testing.
function parseDurationMs(s: string): number {
  const m = /^(\d+)\s*(ms|s|m|h)?$/.exec(s.trim());
  if (!m) return 15 * 60_000;
  const n = Number(m[1]);
  const mult = m[2] === "ms" ? 1 : m[2] === "s" ? 1_000 : m[2] === "h" ? 3_600_000 : 60_000;
  return n * mult;
}
const HARD_MARGIN_MS = Number(Deno.env.get("AGY_HARD_MARGIN_MS") ?? 60_000);
const AGY_HARD_DEADLINE_MS = parseDurationMs(PRINT_TIMEOUT) +
  (Number.isFinite(HARD_MARGIN_MS) && HARD_MARGIN_MS >= 0 ? HARD_MARGIN_MS : 60_000);
const TOOLS_ENABLED = (Deno.env.get("AGY_TOOLS") ?? "on") !== "off";
// "slim" strips per-property descriptions from tool JSON schemas (big token
// savings when opencode sends many tools); "full" keeps them verbatim
const TOOL_SCHEMA = Deno.env.get("AGY_TOOL_SCHEMA") ?? "full";
// Continue agy conversations across turns (fewer sessions, but agy
// reprocesses the whole conversation + re-injects its harness each turn, so
// it costs MORE tokens than stateless — measured, cache never activates)
const REUSE_ENABLED = (Deno.env.get("AGY_REUSE") ?? "off") === "on";
// Shared secret for the loopback API (Authorization: Bearer <token>). Empty
// disables the token check — intended only for throwaway manual runs.
const AGY_TOKEN = Deno.env.get("AGY_TOKEN") ?? "";
const STATE_DIR = Deno.env.get("STATE_DIR") ??
  `${Deno.env.get("HOME")}/.local/state/agy-bridge`;
const USAGE_LOG = `${STATE_DIR}/usage.jsonl`;

// LOCKSTEP:plugin-4pass-live
const FALLBACK_MODELS = [
  "gemini-3.7-flash-high",
  "gemini-3.7-flash-medium",
  "gemini-3.7-flash-low",
  "gemini-3.6-flash-high",
  "gemini-3.6-flash-medium",
  "gemini-3.6-flash-low",
  "gemini-3.5-flash-high",
  "gemini-3.5-flash-medium",
  "gemini-3.5-flash-low",
  "gemini-3.1-pro-high",
  "gemini-3.1-pro-low",
  "claude-sonnet-4-6",
  "claude-opus-4-6-thinking",
  "gpt-oss-120b-medium",
  "gemini-3.8-flash-high",
  "gemini-3.8-flash-medium",
  "gemini-3.8-flash-low",
];

// ---------- autonomous delegation (models prefixed "auto-<profile>-") ----------
//
// "auto-ro-gemini-3.7-flash-high" runs ONE agy session with the profile's own
// agent (native tool loop inside agy) and returns a single completion. Context
// travels once per delegated task instead of once per tool-loop round trip.
// Profiles map to agy agents in ~/.gemini/config/agents/<agent>/agent.md.
interface AutoProfile {
  agent: string;
}

const AUTO_PROFILES: Record<string, AutoProfile> = {
  ro: { agent: "worker-ro" }, // read-only whitelist
  rw: { agent: "worker-rw" }, // reads + file edits + run_command (no shell follow-up tools: they break agy agent init)
};

interface AutoRoute {
  profile: string;
  agent: string;
  real: string;
}

function parseAutoModel(model: string): AutoRoute | null {
  const m = /^auto-([a-z0-9]+)-(.+)$/.exec(model);
  if (!m) return null;
  const profile = AUTO_PROFILES[m[1]];
  if (!profile) return null;
  return { profile: m[1], agent: profile.agent, real: m[2] };
}

// ---------- helpers ----------

const enc = new TextEncoder();

async function* readLines(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let buf = "";
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        yield buf.slice(0, idx);
        buf = buf.slice(idx + 1);
      }
    }
    buf += decoder.decode();
    if (buf.length) yield buf;
  } finally {
    reader.releaseLock();
  }
}

// Deno refuses scoped --allow-run spawns when dynamic-loader env vars would be
// inherited; strip them (keeps manual and systemd launches identical).
const CHILD_ENV_BLOCKLIST = new Set(["LD_LIBRARY_PATH", "LD_PRELOAD", "LD_AUDIT"]);
function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(Deno.env.toObject())) {
    if (!CHILD_ENV_BLOCKLIST.has(k)) env[k] = v;
  }
  return env;
}

async function runCapture(cmd: string[], opts: { timeoutMs?: number } = {}) {
  const child = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdout: "piped",
    stderr: "piped",
    stdin: "null",
    env: childEnv(),
    clearEnv: true,
  }).spawn();
  const timer = opts.timeoutMs
    ? setTimeout(() => child.kill(), opts.timeoutMs)
    : null;
  const [out, err, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.status,
  ]);
  if (timer) clearTimeout(timer);
  return { out, err, code: status.code };
}

async function appendUsage(entry: Record<string, unknown>) {
  try {
    await Deno.mkdir(STATE_DIR, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
    const f = await Deno.open(USAGE_LOG, { append: true, create: true });
    try {
      await f.write(enc.encode(line + "\n"));
    } finally {
      f.close();
    }
  } catch (e) {
    console.error("usage log write failed:", e);
  }
}

// ---------- concurrency gate ----------

let active = 0;
const waiters: Array<() => void> = [];

async function acquire(): Promise<() => void> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiters.push(resolve));
    // release() handed us slot ownership synchronously, BEFORE this
    // continuation ran: active already counts us. Incrementing here would
    // open a barge-in window where a fresh arrival sees a decremented
    // counter and double-subscribes past MAX_CONCURRENT.
  } else {
    active++;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = waiters.shift();
    if (next) next(); // transfer the slot directly; active stays as-is
    else active--;
  };
}

// ---------- models ----------

let modelSlugs: string[] = FALLBACK_MODELS;

async function refreshModels(): Promise<string[]> {
  const { out, code } = await runCapture([AGY_BIN, "models"], {
    timeoutMs: 30_000,
  });
  if (code === 0) {
    // output is TSV: "<slug>\t<display name>"
    const listed = out.split("\n").map((l) => l.split("\t")[0].trim()).filter(
      Boolean,
    );
    if (listed.length) modelSlugs = listed;
  } else {
    console.error("agy models failed, keeping cached list:", code);
  }
  return modelSlugs;
}

// ---------- OpenAI request types (subset) ----------

interface OAIChatRequest {
  model?: string;
  messages?: AIMessage[];
  stream?: boolean;
  tools?: Array<{
    type?: string;
    function?: { name?: string; description?: string; parameters?: unknown };
  }>;
  [k: string]: unknown;
}

interface AIMessage {
  role: "system" | "user" | "assistant" | "tool" | (string & {});
  content?: string | Array<{ type?: string; text?: string }> | null;
  tool_calls?: Array<{
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

function textContent(m: AIMessage): string {
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) {
    return m.content
      .map((p) => p?.type === "text" ? p.text ?? "" : "")
      .join("");
  }
  return "";
}

// ---------- prompt rendering ----------

const TOOL_PROTOCOL = `
# Tools

You can call tools by replying ONLY with one or more blocks in this exact
format (no other text, no markdown fences around them):

<tool_call>{"name":"tool_name","arguments":{...}}</tool_call>

Each call's result will be given to you in the next turn as:

<tool_result name="tool_name">result text</tool_result>

Rules:
- To call tools, your ENTIRE reply must consist only of <tool_call> blocks.
- After receiving <tool_result> blocks, continue the task (call more tools or
  give the final answer).
- The final answer is plain text with no <tool_call> blocks.
`;

function stripSchemaDescriptions(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripSchemaDescriptions);
  if (v === null || typeof v !== "object") return v;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (k === "description" || k === "$schema" || k === "default") continue;
    out[k] = stripSchemaDescriptions(val);
  }
  return out;
}

function renderTools(tools: NonNullable<OAIChatRequest["tools"]>): string {
  const lines = tools
    .filter((t) => t.function?.name)
    .map((t) => {
      const f = t.function!;
      let parameters: unknown = f.parameters ?? { type: "object" };
      if (TOOL_SCHEMA === "slim") parameters = stripSchemaDescriptions(parameters);
      const params = JSON.stringify(parameters);
      const desc = f.description ?? "";
      return `<tool name="${f.name}">\n  description: ${desc}\n  parameters: ${params}\n</tool>`;
    });
  return TOOL_PROTOCOL + "\nAvailable tools:\n" + lines.join("\n") + "\n";
}

interface RenderedPrompt {
  prompt: string;
  toolsChars: number;
  systemChars: number;
  historyChars: number;
}

function renderBlocks(msgs: AIMessage[]): string[] {
  const blocks: string[] = [];
  for (const m of msgs) {
    const text = textContent(m).trim();
    switch (m.role) {
      case "system":
        if (text) blocks.push(`System: ${text}`);
        break;
      case "user":
        blocks.push(`User: ${text}`);
        break;
      case "assistant": {
        const calls = (m.tool_calls ?? [])
          .map((c) =>
            `<tool_call>{"name":${JSON.stringify(c.function?.name ?? "")},"arguments":${
              safeParse(c.function?.arguments ?? "{}")
            }}</tool_call>`
          )
          .join("\n");
        blocks.push(`Assistant: ${calls ? calls + "\n" : ""}${text}`);
        break;
      }
      case "tool": {
        const name = m.name ?? m.tool_call_id ?? "tool";
        blocks.push(`<tool_result name="${name}">\n${text}\n</tool_result>`);
        break;
      }
      default:
        blocks.push(`${m.role}: ${text}`);
    }
  }
  return blocks;
}

const REPLY_TAIL = (useTools: boolean) => `
# Your reply

Reply ONLY with the Assistant's next message. No "Assistant:" prefix, no
commentary about this format.${
  useTools
    ? " If you need tools, your whole reply must be only <tool_call> blocks."
    : ""
}`;

function renderPrompt(req: OAIChatRequest): RenderedPrompt {
  const system: string[] = [];
  const useTools = TOOLS_ENABLED && (req.tools?.length ?? 0) > 0;
  let toolsChars = 0;
  if (useTools) {
    const t = renderTools(req.tools!);
    toolsChars = t.length;
    system.push(t);
  }
  for (const m of req.messages ?? []) {
    if (m.role === "system") {
      const text = textContent(m).trim();
      if (text) system.push(text);
    }
  }
  const transcript = renderBlocks((req.messages ?? []).filter((m) => m.role !== "system"));

  const head = system.length
    ? "# System instructions\n\n" + system.join("\n\n") + "\n\n"
    : "";
  const prompt = `${head}# Conversation transcript

${transcript.join("\n\n")}
${REPLY_TAIL(useTools)}`;

  return {
    prompt,
    toolsChars,
    systemChars: system.filter((_, i) => i > 0 || !useTools).join("\n\n").length,
    historyChars: transcript.join("\n\n").length,
  };
}

function renderContinuation(newMsgs: AIMessage[], useTools: boolean): string {
  return `# Continuation

${renderBlocks(newMsgs).join("\n\n")}
${REPLY_TAIL(useTools)}`;
}

// ---------- autonomous prompt rendering ----------

const AUTONOMOUS_TAIL = `
# Execution

Complete the task above autonomously, using your tools as many times as needed.
When finished, your final message must be the complete deliverable requested:
self-contained and ready to be consumed by an orchestrator without further
context.`;

// Narration disclosure (bridge-live-thoughts Phase 6): appended to the
// autonomous prompt ONLY in the streaming branch of handleAutonomousChat so
// intermediate agent_response deltas narrate tool activity live. Non-auto
// paths (renderPrompt/preparePrompt) and non-streaming calls never see it.
// Mirrored in plugins/agy-bridge-helpers.ts for unit tests — keep in sync.
const NARRATION_SUFFIX =
  "IMPORTANT: before every tool call, first emit one short line starting with NOTE: explaining what you are about to do and why. Keep each NOTE to one sentence.";

function renderAutonomousPrompt(req: OAIChatRequest): RenderedPrompt {
  const system: string[] = [];
  for (const m of req.messages ?? []) {
    if (m.role === "system") {
      const text = textContent(m).trim();
      if (text) system.push(text);
    }
  }
  const transcript = renderBlocks(
    (req.messages ?? []).filter((m) => m.role !== "system"),
  );
  const head = system.length
    ? "# System instructions\n\n" + system.join("\n\n") + "\n\n"
    : "";
  const history = transcript.join("\n\n");
  return {
    prompt: `${head}# Conversation transcript\n\n${history}\n${AUTONOMOUS_TAIL}`,
    toolsChars: 0,
    systemChars: head.length,
    historyChars: history.length,
  };
}

// ---------- conversation reuse (AGY_REUSE, default off) ----------

async function sha(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function canonicalMsg(m: AIMessage): string {
  return JSON.stringify({
    role: m.role,
    content: m.content ?? null,
    tool_calls: m.tool_calls ?? null,
    tool_call_id: m.tool_call_id ?? null,
    name: m.name ?? null,
  });
}

interface ConvEntry {
  agyConvId: string;
  msgHashes: string[];
  lastUsed: number;
}
const convStore = new Map<string, ConvEntry[]>();
const CONV_MAX = 64;

function evictConvStore() {
  let total = 0;
  for (const v of convStore.values()) total += v.length;
  while (total > CONV_MAX) {
    let oldestKey: string | null = null;
    let oldestIdx = -1;
    let oldestTs = Infinity;
    for (const [k, arr] of convStore) {
      arr.forEach((e, i) => {
        if (e.lastUsed < oldestTs) {
          oldestTs = e.lastUsed;
          oldestKey = k;
          oldestIdx = i;
        }
      });
    }
    if (!oldestKey || oldestIdx < 0) break;
    const arr = convStore.get(oldestKey!)!;
    arr.splice(oldestIdx, 1);
    if (!arr.length) convStore.delete(oldestKey);
    total--;
  }
}

interface PreparedPrompt extends RenderedPrompt {
  fullPrompt: string;
  conversationId?: string;
  continued: boolean;
  commit?: (agyConvId: string) => void;
  evict?: () => void;
}

async function preparePrompt(req: OAIChatRequest, model: string): Promise<PreparedPrompt> {
  const full = renderPrompt(req);
  if (!REUSE_ENABLED || !(req.messages?.length)) {
    return { ...full, fullPrompt: full.prompt, continued: false };
  }
  const msgs = req.messages!;
  const ctxHash = await sha(
    JSON.stringify({
      system: msgs.filter((m) => m.role === "system").map((m) => textContent(m)),
      tools: req.tools ?? null,
      agent: AGY_AGENT,
    }),
  );
  const key = `${ctxHash}:${model}`;
  const hashes = await Promise.all(msgs.map((m) => sha(canonicalMsg(m))));

  let entry: ConvEntry | undefined;
  if (convStore.has(key)) {
    let bestLen = 0;
    for (const e of convStore.get(key)!) {
      if (
        e.msgHashes.length > bestLen &&
        e.msgHashes.length < hashes.length &&
        e.msgHashes.every((h, i) => h === hashes[i])
      ) {
        entry = e;
        bestLen = e.msgHashes.length;
      }
    }
  }

  const useTools = TOOLS_ENABLED && (req.tools?.length ?? 0) > 0;
  if (entry) {
    entry.lastUsed = Date.now();
    const contPrompt = renderContinuation(msgs.slice(entry.msgHashes.length), useTools);
    return {
      ...full,
      prompt: contPrompt,
      fullPrompt: full.prompt,
      conversationId: entry.agyConvId,
      continued: true,
      commit: (convId) => {
        entry!.agyConvId = convId;
        entry!.msgHashes = hashes;
      },
      evict: () => {
        const arr = convStore.get(key);
        if (arr) {
          const i = arr.indexOf(entry!);
          if (i >= 0) arr.splice(i, 1);
          if (!arr.length) convStore.delete(key);
        }
      },
    };
  }

  // no match: fresh conversation, but remember it for later turns
  const key_ = key;
  const hashes_ = hashes;
  return {
    ...full,
    fullPrompt: full.prompt,
    continued: false,
    commit: (convId: string) => {
      const arr = convStore.get(key_) ?? [];
      arr.push({ agyConvId: convId, msgHashes: hashes_, lastUsed: Date.now() });
      convStore.set(key_, arr);
      evictConvStore();
    },
    evict: undefined,
  };
}

function safeParse(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s));
  } catch {
    return s;
  }
}

// ---------- tool_call parsing of agy responses ----------

interface ParsedToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

const TOOL_CALL_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;

function parseToolCalls(
  text: string,
): { content: string; tool_calls: ParsedToolCall[] } {
  const tool_calls: ParsedToolCall[] = [];
  let content = "";
  let last = 0;
  for (const m of text.matchAll(TOOL_CALL_RE)) {
    content += text.slice(last, m.index);
    last = m.index! + m[0].length;
    let raw = m[1].trim();
    const fence = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    if (fence) raw = fence[1].trim();
    try {
      const parsed = JSON.parse(raw);
      const name = String(parsed.name ?? parsed.function?.name ?? "");
      let args = parsed.arguments ?? parsed.function?.arguments ?? {};
      if (typeof args !== "string") args = JSON.stringify(args);
      tool_calls.push({
        id: `call_${tool_calls.length + 1}`,
        type: "function",
        function: { name, arguments: args },
      });
    } catch (e) {
      console.error("unparseable tool_call block, kept as text:", e);
      content += m[0];
    }
  }
  content += text.slice(last);
  return { content: content.trim(), tool_calls };
}

// ---------- agy invocation ----------

interface AgyResult {
  ok: boolean;
  text: string;
  conversationId?: string;
  usage?: Record<string, number>;
  error?: string;
}

type DeltaKind = "agent_response" | "thought" | "tool" | "unknown";

interface AgyStreamHandlers {
  onDelta?: (kind: DeltaKind, text: string) => void;
  log?: Record<string, unknown>;
  commit?: (agyConvId: string) => void;
  evict?: () => void;
}

async function runAgy(
  model: string,
  prompt: string,
  handlers: AgyStreamHandlers = {},
  signal?: AbortSignal,
  conversationId?: string,
  agent: string = AGY_AGENT,
): Promise<AgyResult> {
  const release = await acquire();
  const started = Date.now();
  const args = [
    "--agent", agent,
    "--model", model,
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--print-timeout", PRINT_TIMEOUT,
  ];
  if (conversationId) args.push("--conversation", conversationId);
  const child = new Deno.Command(AGY_BIN, {
    args,
    stdout: "piped",
    stderr: "piped",
    stdin: "piped",
    env: childEnv(),
    clearEnv: true,
  }).spawn();

  // Prompts can exceed the 128 KiB per-argv Linux limit (opencode orchestrator
  // system prompts do), so the prompt travels on stdin as a single NDJSON user
  // event — agy's documented stream-json input protocol.
  const stdinWriter = child.stdin.getWriter();
  try {
    await stdinWriter.write(
      enc.encode(JSON.stringify({ event: "user", message: { content: prompt } }) + "\n"),
    );
  } finally {
    stdinWriter.releaseLock();
  }
  await child.stdin.close();

  // Drain stderr concurrently so a chatty agy can never block on a full pipe;
  // .catch keeps a rare drain rejection from becoming an unhandled rejection
  // that would abort the whole isolate mid-flight.
  const stderrText = new Response(child.stderr).text().catch(() => "");

  // Escalating kill: agy (or whatever it spawned) may ignore SIGTERM; SIGKILL
  // cannot be ignored. `exited` is tracked to avoid pointless signals.
  let exited = false;
  void child.status.then(
    () => { exited = true; },
    () => { exited = true; },
  );
  let escalateTimer: ReturnType<typeof setTimeout> | null = null;
  const killHard = () => {
    if (exited) return;
    try { child.kill("SIGTERM"); } catch { /* already dead */ }
    if (escalateTimer === null) {
      escalateTimer = setTimeout(() => {
        if (!exited) {
          try { child.kill("SIGKILL"); } catch { /* already dead */ }
        }
      }, 3_000);
    }
  };
  const onAbort = () => killHard();
  signal?.addEventListener("abort", onAbort, { once: true });

  const result: AgyResult = { ok: false, text: "" };
  let recoveredSalvage = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  try {
    // The flow may never complete on its own: an orphaned run_command
    // grandchild can hold the stdout pipe open forever (EOF requires ALL
    // writers to close), and agy itself might hang past --print-timeout.
    // Hence Promise.race against our own hard deadline below.
    const flow = (async () => {
      for await (const line of readLines(child.stdout)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (ev.event === "step_update") {
          const su = ev.step_update as Record<string, unknown>;
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
            handlers.onDelta?.(kind, su.text_delta);
          }
        } else if (ev.event === "result") {
          const r = ev.result as Record<string, unknown>;
          result.conversationId = r.conversation_id as string;
          result.usage = r.usage as Record<string, number>;
          if (r.status === "SUCCESS") {
            result.ok = true;
            result.text = (r.response as string ?? "").trimEnd();
          } else {
            result.error = (r.error as string) || `agy status: ${r.status}`;
          }
        }
      }
      const status = await child.status;
      if (!result.ok && !result.error) {
        const errText = await stderrText;
        result.error = errText.trim() || `agy exited with code ${status.code}`;
      }
    })();

    const outcome = await Promise.race([
      flow.then(() => "done" as const),
      new Promise<"deadline">((res) => {
        watchdog = setTimeout(() => res("deadline"), AGY_HARD_DEADLINE_MS);
      }),
    ]);

    if (outcome === "deadline") {
      if (!result.error) {
        result.error = `agy hard deadline exceeded (${PRINT_TIMEOUT} + ${HARD_MARGIN_MS}ms margin)`;
      }
      console.error(
        `runAgy hard deadline (${model}, ${AGY_HARD_DEADLINE_MS}ms): escalating kill`,
      );
      killHard();
      // Deliberately NOT awaiting `flow`: orphaned grandchildren may keep the
      // pipes open indefinitely. The gate must free NOW; the zombie flow keeps
      // draining harmlessly with commit/evict skipped by the guard below.
    }
    // (deadline timer cleanup happens in `finally`)

    // Conversation-store side effects only on clean completion — a deadline
    // or abort must never leave stale conversation entries behind.
    if (outcome === "done") {
      if (result.ok && result.conversationId) handlers.commit?.(result.conversationId);
      if (!result.ok && conversationId) handlers.evict?.();
      // Natural agy-side failure after real work: try to salvage the finished
      // report from the session transcript before failing the client.
      if (!result.ok && result.conversationId && !signal?.aborted) {
        const salvaged = await salvageFinalResponse(result.conversationId);
        if (salvaged !== null) {
          result.text = salvaged;
          result.ok = true;
          recoveredSalvage = true;
          console.error(
            `runAgy: session errored but final report salvaged from transcript (${result.text.length} chars)`,
          );
        }
      }
    }
  } finally {
    if (watchdog !== null) clearTimeout(watchdog);
    if (escalateTimer !== null) clearTimeout(escalateTimer);
    signal?.removeEventListener("abort", onAbort);
    release();
    const dur = (Date.now() - started) / 1000;
    await appendUsage({
      model,
      duration_s: Number(dur.toFixed(2)),
      ok: result.ok,
      conversation_id: result.conversationId,
      tokens: result.usage,
      error: result.error,
      ...(recoveredSalvage ? { recovered: true } : {}),
      ...(handlers.log ?? {}),
    });
  }
  return result;
}

// ---------- OpenAI response shapes ----------

// Rescue mechanism: agy sometimes marks a whole session as ERROR after real
// work completed (e.g. a trailing malformed MCP call like "relation is
// required"). The finished report still lives in the session transcript.
// Recover the LAST substantive planner response so the orchestrator gets the
// deliverable instead of a bare error.
async function salvageFinalResponse(conversationId: string): Promise<string | null> {
  const base =
    `${Deno.env.get("HOME")}/.gemini/antigravity-cli/brain/${conversationId}` +
    "/.system_generated/logs";
  for (const name of ["transcript_full.jsonl", "transcript.jsonl"]) {
    try {
      const text = await Deno.readTextFile(`${base}/${name}`);
      let last: string | null = null;
      for (const line of text.split("\n")) {
        const t = line.trim();
        if (!t.startsWith("{")) continue;
        try {
          const ev = JSON.parse(t) as Record<string, unknown>;
          if (
            ev.type === "PLANNER_RESPONSE" &&
            typeof ev.content === "string" &&
            ev.content !== "null" &&
            ev.content.trim().length > 0
          ) {
            last = ev.content;
          }
        } catch { /* skip malformed line */ }
      }
      if (last !== null) return last.trimEnd();
    } catch { /* file missing: try next candidate */ }
  }
  return null;
}

const genId = () => `agy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function oaiUsage(u?: Record<string, number>) {
  const p = u?.input_tokens ?? 0;
  const c = (u?.output_tokens ?? 0) + (u?.thinking_tokens ?? 0);
  return {
    prompt_tokens: p,
    completion_tokens: c,
    total_tokens: u?.total_tokens ?? p + c,
  };
}

function jsonError(status: number, message: string) {
  return new Response(
    JSON.stringify({ error: { message, type: "agy_bridge_error", code: status } }),
    { status, headers: { "content-type": "application/json" } },
  );
}

// ---------- autonomous delegation handler ----------

async function handleAutonomousChat(
  req: Request,
  body: OAIChatRequest,
  modelStr: string,
  auto: AutoRoute,
): Promise<Response> {
  const prepared = renderAutonomousPrompt(body);
  const log = {
    autonomous: auto.profile,
    agent: auto.agent,
    msgs: body.messages?.length ?? 0,
    prompt_chars: prepared.prompt.length,
    tools_chars: 0,
    system_chars: prepared.systemChars,
    history_chars: prepared.historyChars,
    delta_chars: 0,
  };
  const id = genId();
  const created = Math.floor(Date.now() / 1000);

  if (body.stream !== true) {
    const r = await runAgy(
      auto.real,
      prepared.prompt,
      { log },
      req.signal,
      undefined,
      auto.agent,
    );
    if (!r.ok) return jsonError(502, r.error ?? "agy failed");
    return Response.json({
      id,
      object: "chat.completion",
      created,
      model: modelStr,
      choices: [{
        index: 0,
        message: { role: "assistant", content: r.text },
        finish_reason: "stop",
      }],
      usage: oaiUsage(r.usage),
    });
  }

  // Streaming: agy's step deltas are NOT guaranteed to equal the final
  // result.response once native tools run mid-turn, so we deliver the final
  // text in one chunk and keep the connection alive with SSE comments
  // (": keepalive") while agy works. delta_chars is logged for measurement.
  const sse = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Self-defending sender: when the client disconnects (or the stream is
      // torn down under us), further enqueues throw TypeError per event and
      // spam the journal. Flip `closed` on the FIRST failure, stay silent
      // after, and always attempt [DONE]+close defensively.
      let closed = false;
      const sendRaw = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          closed = true;
        }
      };
      const send = (obj: unknown) => sendRaw(`data: ${JSON.stringify(obj)}\n\n`);
      const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
        send({
          id,
          object: "chat.completion.chunk",
          created,
          model: modelStr,
          choices: [{ index: 0, delta, finish_reason: finish }],
        });

      const ka = setInterval(() => sendRaw(`: keepalive ${Date.now()}\n\n`), 10_000);
      try {
        chunk({ role: "assistant" });
        const streamingPrompt = prepared.prompt + NARRATION_SUFFIX;
        const r = await runAgy(auto.real, streamingPrompt, {
          onDelta: (kind, d) => {
            if (!d) return;
            log.delta_chars += d.length;
            if (kind === "agent_response") {
              chunk({ content: d });
            } else {
              chunk({ reasoning_content: d });
            }
          },
          log,
        }, req.signal, undefined, auto.agent);
        if (!r.ok) {
          send({ error: { message: r.error ?? "agy failed", code: 502 } });
        } else {
          chunk({}, "stop");
          send({ id, object: "chat.completion.chunk", created, model: modelStr, choices: [], usage: oaiUsage(r.usage) });
        }
      } catch (e) {
        console.error("autonomous stream error:", e);
        try {
          send({ error: { message: String(e), code: 500 } });
        } catch { /* controller closed */ }
      } finally {
        clearInterval(ka);
        try {
          sendRaw("data: [DONE]\n\n");
          controller.close();
        } catch { /* already closed */ }
      }
    },
  });

  return new Response(sse, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

// ---------- HTTP server ----------

// Second layer over loopback binding: rejects other local processes and
// DNS-rebinding web pages (Host header pointing elsewhere) before any route.
function accessGuard(req: Request): Response | null {
  const host = req.headers.get("host") ?? "";
  if (
    !host.startsWith("127.0.0.1:") && host !== "127.0.0.1" &&
    !host.startsWith("localhost:") && host !== "localhost"
  ) {
    return jsonError(403, "forbidden host");
  }
  if (AGY_TOKEN && req.headers.get("authorization") !== `Bearer ${AGY_TOKEN}`) {
    return jsonError(401, "unauthorized");
  }
  return null;
}

async function handleChat(req: Request): Promise<Response> {
  let body: OAIChatRequest;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  const model = String(body.model ?? "");
  if (!model) return jsonError(400, "missing model");
  const auto = parseAutoModel(model);
  if (auto) {
    if (!modelSlugs.includes(auto.real)) {
      return jsonError(
        400,
        `unknown model "${auto.real}" in "${model}"; available: ${modelSlugs.join(", ")}`,
      );
    }
    return handleAutonomousChat(req, body, model, auto);
  }
  if (!modelSlugs.includes(model)) {
    return jsonError(
      400,
      `unknown model "${model}"; available: ${modelSlugs.join(", ")}`,
    );
  }

  const prepared = await preparePrompt(body, model);
  const { prompt } = prepared;
  const useTools = TOOLS_ENABLED && (body.tools?.length ?? 0) > 0;
  const log = {
    continued: prepared.continued,
    msgs: body.messages?.length ?? 0,
    prompt_chars: prompt.length,
    tools_chars: prepared.toolsChars,
    system_chars: prepared.systemChars,
    history_chars: prepared.historyChars,
    delta_chars: 0,
  };
  const stream = body.stream === true;
  const id = genId();
  const created = Math.floor(Date.now() / 1000);

  if (!stream) {
    let r = await runAgy(
      model,
      prompt,
      { log, commit: prepared.commit, evict: prepared.evict },
      req.signal,
      prepared.conversationId,
    );
    if (!r.ok && prepared.continued) {
      // stale conversation (expired/deleted): retry once as a fresh one
      const fresh = await preparePrompt(body, model);
      r = await runAgy(model, fresh.prompt, {
        log: { ...log, continued: false },
        commit: fresh.commit,
      }, req.signal);
    }
    if (!r.ok) return jsonError(502, r.error ?? "agy failed");
    if (useTools) {
      const { content, tool_calls } = parseToolCalls(r.text);
      const message: Record<string, unknown> = { role: "assistant", content };
      if (tool_calls.length) {
        message.tool_calls = tool_calls;
        message.content = content || null;
      }
      return Response.json({
        id,
        object: "chat.completion",
        created,
        model,
        choices: [{
          index: 0,
          message,
          finish_reason: tool_calls.length ? "tool_calls" : "stop",
        }],
        usage: oaiUsage(r.usage),
      });
    }
    return Response.json({
      id,
      object: "chat.completion",
      created,
      model,
      choices: [{
        index: 0,
        message: { role: "assistant", content: r.text },
        finish_reason: "stop",
      }],
      usage: oaiUsage(r.usage),
    });
  }

  // streaming: if tool protocol is active we must buffer the whole response
  // to parse <tool_call> blocks; otherwise we stream text deltas.
  const sse = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Same self-defending sender pattern as the autonomous stream: a
      // vanished client must degrade to silence, never to TypeError spam.
      let closed = false;
      const sendRaw = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          closed = true;
        }
      };
      const send = (obj: unknown) => sendRaw(`data: ${JSON.stringify(obj)}\n\n`);
      const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
        send({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta, finish_reason: finish }],
        });

      const ka = setInterval(() => sendRaw(`: keepalive ${Date.now()}\n\n`), 10_000);
      try {
        chunk({ role: "assistant" });
        if (useTools) {
          const r = await runAgy(
            model,
            prompt,
            {
              onDelta: (kind, d) => {
                if (!d) return;
                log.delta_chars += d.length;
                if (kind === "agent_response") {
                  chunk({ content: d });
                } else {
                  chunk({ reasoning_content: d });
                }
              },
              log,
              commit: prepared.commit,
              evict: prepared.evict,
            },
            req.signal,
            prepared.conversationId,
          );
          if (!r.ok) {
            send({ error: { message: r.error ?? "agy failed", code: 502 } });
          } else {
            const { tool_calls } = parseToolCalls(r.text);
            if (tool_calls.length) {
              chunk({ role: "assistant", tool_calls }, "tool_calls");
              send({ id, object: "chat.completion.chunk", created, model, choices: [], usage: oaiUsage(r.usage) });
            } else {
              chunk({}, "stop");
              send({ id, object: "chat.completion.chunk", created, model, choices: [], usage: oaiUsage(r.usage) });
            }
          }
        } else {
          const r = await runAgy(model, prompt, {
            onDelta: (kind, d) => {
              if (!d) return;
              log.delta_chars += d.length;
              if (kind === "agent_response") {
                chunk({ content: d });
              } else {
                chunk({ reasoning_content: d });
              }
            },
            log,
            commit: prepared.commit,
            evict: prepared.evict,
          }, req.signal, prepared.conversationId);
          if (!r.ok) {
            send({ error: { message: r.error ?? "agy failed", code: 502 } });
          } else {
            chunk({}, "stop");
            send({ id, object: "chat.completion.chunk", created, model, choices: [], usage: oaiUsage(r.usage) });
          }
        }
      } catch (e) {
        console.error("stream error:", e);
        try {
          send({ error: { message: String(e), code: 500 } });
        } catch { /* controller closed */ }
      } finally {
        clearInterval(ka);
        sendRaw("data: [DONE]\n\n");
        try {
          controller.close();
        } catch { /* already closed */ }
      }
    },
  });

  return new Response(sse, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

Deno.serve({ port: PORT, hostname: HOSTNAME }, async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET" && (url.pathname === "/healthz" || url.pathname === "/v1/healthz")) {
    // Open on purpose (liveness probe), but minimal: no catalog details.
    return Response.json({ ok: true });
  }
  const denied = accessGuard(req);
  if (denied) return denied;
  if (req.method === "GET" && (url.pathname === "/v1/models" || url.pathname === "/models")) {
    await refreshModels();
    return Response.json({
      object: "list",
      data: modelSlugs.map((m) => ({ id: m, object: "model", owned_by: "antigravity" })),
    });
  }
  if (
    req.method === "POST" &&
    (url.pathname === "/v1/chat/completions" || url.pathname === "/chat/completions")
  ) {
    return handleChat(req);
  }
  return jsonError(404, `no route: ${req.method} ${url.pathname}`);
});

console.log(
  `agy-bridge listening on http://${HOSTNAME}:${PORT} (agent=${AGY_AGENT}, tools=${
    TOOLS_ENABLED ? "on" : "off"
  }, max_concurrent=${MAX_CONCURRENT}${AGY_TOKEN ? ", auth=on" : ", auth=OFF"})`,
);
if (!AGY_TOKEN) {
  console.error("AGY_TOKEN not set: bearer auth is DISABLED (loopback binding only)");
}
await refreshModels();
