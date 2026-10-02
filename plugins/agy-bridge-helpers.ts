// LOCKSTEP:plugin-4pass-live
// Model-map version: bump to invalidate downstream variant caches
// (e.g. ~/.gentle-ai/cache/model-variants.json) after declared-map changes.
// v3: thinking Map disposition — variants advertise reasoningEffort "max"
// for "thinking" (spike obs #101: "thinking" is not in opencode's enum).
// v4: explicit variant masking — undeclared generic efforts are emitted as
// {disabled:true} so the runtime merge cannot inject unmasked entries;
// downstream filters disabled before caching/rendering.
// v4 unchanged by opencode-v2-dual T2: the V2 port is additive and declares the
// SAME slugs/efforts, so no downstream cache needs invalidating. The V2 map
// (buildModelV2) masks by omission + a model transform, not by {disabled:true}.
export const MODEL_MAP_VERSION = 4;
export const FALLBACK_MODELS = [
  "gemini-3.7-flash-high",
  "gemini-3.7-flash-medium",
  "gemini-3.7-flash-low",
  "gemini-3.6-flash-high",
  "gemini-3.6-flash-medium",
  "gemini-3.6-flash-low",
  "gemini-3.1-pro-high",
  "gemini-3.1-pro-low",
  "claude-sonnet-4-6",
  "claude-opus-4-6-thinking",
  "gpt-oss-120b-medium",
  "gemini-3.8-flash-high",
  "gemini-3.8-flash-medium",
  "gemini-3.8-flash-low",
] as const

export const EFFORT_SUFFIXES = ["high", "medium", "low", "thinking"] as const

export function stripEffortSuffix(
  slug: string,
  extraSuffixes?: readonly string[],
): { base: string; variant?: string } {
  const suffixes = extraSuffixes ? [...EFFORT_SUFFIXES, ...extraSuffixes] : EFFORT_SUFFIXES
  for (const suffix of suffixes) {
    const needle = `-${suffix}`
    if (slug.endsWith(needle)) {
      return { base: slug.slice(0, -needle.length), variant: suffix }
    }
  }
  return { base: slug }
}

export function groupBases(slugs: readonly string[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  const unassigned: string[] = []

  // Pass 1: standard known effort suffixes
  for (const slug of slugs) {
    const { base, variant } = stripEffortSuffix(slug)
    if (variant) {
      if (!map.has(base)) map.set(base, new Set<string>())
      map.get(base)!.add(variant)
    } else {
      unassigned.push(slug)
    }
  }

  // Pass 2: match unassigned slugs against known bases (e.g. gemini-3.8-flash-ultra matching gemini-3.8-flash)
  const remaining: string[] = []
  for (const slug of unassigned) {
    let matched = false
    for (const knownBase of map.keys()) {
      if (slug.startsWith(`${knownBase}-`)) {
        const variant = slug.slice(knownBase.length + 1)
        if (variant && !variant.includes("/")) {
          map.get(knownBase)!.add(variant)
          matched = true
          break
        }
      }
    }
    if (!matched) {
      remaining.push(slug)
    }
  }

  // Pass 3: detect new multi-variant bases sharing a prefix before last '-'
  // e.g. ["gemini-3.9-pro-ultra", "gemini-3.9-pro-max"]
  const prefixMap = new Map<string, string[]>()
  for (const slug of remaining) {
    const lastDash = slug.lastIndexOf("-")
    if (lastDash > 0) {
      const baseCandidate = slug.slice(0, lastDash)
      const variantCandidate = slug.slice(lastDash + 1)
      if (/^[a-zA-Z]+$/.test(variantCandidate)) {
        if (!prefixMap.has(baseCandidate)) prefixMap.set(baseCandidate, [])
        prefixMap.get(baseCandidate)!.push(slug)
      }
    }
  }

  const finalRemaining = new Set(remaining)
  for (const [baseCandidate, group] of prefixMap.entries()) {
    if (group.length > 1) {
      if (!map.has(baseCandidate)) map.set(baseCandidate, new Set<string>())
      for (const slug of group) {
        const variant = slug.slice(baseCandidate.length + 1)
        map.get(baseCandidate)!.add(variant)
        finalRemaining.delete(slug)
      }
    }
  }

  // Pass 4: singletons (no variants)
  for (const slug of finalRemaining) {
    if (!map.has(slug)) map.set(slug, new Set<string>())
  }

  return map
}

export function wireModel(base: string, variant?: string): string {
  return variant ? `${base}-${variant}` : base
}

/**
 * Extracts every accepted variant signal from an OpenAI chat-completions
 * body, in fixed order: flat `reasoning_effort`, nested `reasoning.effort`,
 * `variant`. Empty strings, `"default"` (opencode's unset marker — treated
 * as absent), and non-string values are filtered out. The slug suffix is
 * NOT read here: it is wire-model parsing, not body parsing.
 */
export function variantSignals(
  body: {
    reasoning_effort?: unknown;
    reasoning?: unknown;
    variant?: unknown;
  },
): string[] {
  const nested = typeof body.reasoning === "object" && body.reasoning !== null
    ? (body.reasoning as { effort?: unknown }).effort
    : undefined;
  return [body.reasoning_effort, nested, body.variant].filter(
    (s): s is string => typeof s === "string" && s !== "" && s !== "default",
  );
}

export type ResolveWireResult =
  | { ok: true; slug: string }
  | { ok: false; message: string };

function availableSlugs(declared: Map<string, Set<string>>): string[] {
  const out: string[] = [];
  const bases = [...declared.entries()].sort(([a], [b]) => a < b ? -1 : 1);
  for (const [base, efforts] of bases) {
    if (efforts.size === 0) {
      out.push(base);
    } else {
      for (const e of [...efforts].sort()) out.push(`${base}-${e}`);
    }
  }
  return out;
}

/**
 * Strict fail-closed wire-model validator. Resolves an `auto-ro/rw-` wire
 * model plus all present variant signals (flat reasoning_effort, nested
 * reasoning.effort, variant — as extracted by `variantSignals`) to a bridge
 * slug (`<base>-<effort>`), or rejects with a 400 message naming available
 * suffixed slugs. The slug suffix is parsed from the wire model internally,
 * so the caller never mixes body signals with slug parsing. Normalization
 * applies ONLY when exactly one agreed signal is a member of the declared
 * set; singletons (zero variants) pass verbatim.
 */
export function resolveWireModel(
  wire: string,
  signals: readonly (string | undefined)[],
  declared: Map<string, Set<string>>,
): ResolveWireResult {
  const auto = /^auto-(ro|rw)-(.+)$/.exec(wire);
  if (!auto) {
    return {
      ok: false,
      message: `unknown model "${wire}"; available: ${
        availableSlugs(declared).join(", ")
      }`,
    };
  }
  const prefix = `auto-${auto[1]}`;
  const rest = auto[2];
  const { base, variant: suffixVariant } = stripEffortSuffix(rest);
  const efforts = declared.get(base);
  if (!efforts) {
    return {
      ok: false,
      message: `unknown model "${rest}" in "${wire}"; available: ${
        availableSlugs(declared).join(", ")
      }`,
    };
  }
  const aliased = (s: string): string =>
    // Reverse alias for the thinking enum gap (spike obs #101): opencode
    // advertises the "thinking" variant with reasoningEffort "max", so an
    // arriving "max" signal maps back to the declared "thinking" effort.
    // Scoped: only when "thinking" is declared and "max" is not itself.
    s === "max" && !efforts.has("max") && efforts.has("thinking")
      ? "thinking"
      : s;
  const all = [suffixVariant, ...signals]
    .filter(
      (s): s is string => typeof s === "string" && s !== "" && s !== "default",
    )
    .map(aliased);
  if (efforts.size === 0) {
    if (all.length > 0) {
      return {
        ok: false,
        message: `unknown variant "${
          all[0]
        }" for base "${base}"; available: ${base}`,
      };
    }
    return { ok: true, slug: base };
  }
  if (all.length === 0) {
    const avail = [...efforts].sort().map((e) => `${prefix}-${base}-${e}`);
    return {
      ok: false,
      message: `ambiguous model "${wire}"; specify one of: ${avail.join(", ")}`,
    };
  }
  const first = all[0];
  if (!all.every((s) => s === first)) {
    return {
      ok: false,
      message: `conflicting variant signals ${
        all.map((s) => `"${s}"`).join(", ")
      } for base "${base}"; available: ${
        [...efforts].sort().map((e) => `${prefix}-${base}-${e}`).join(", ")
      }`,
    };
  }
  if (!efforts.has(first)) {
    return {
      ok: false,
      message: `unknown variant "${first}" for base "${base}"; available: ${
        [...efforts].sort().map((e) => `${prefix}-${base}-${e}`).join(", ")
      }`,
    };
  }
  return { ok: true, slug: `${base}-${first}` };
}

export type VariantSpec = { reasoningEffort: string } | { disabled: true }

// Generic effort keys the OpenCode runtime injects for `reasoning: true`
// models. Pre-populating every key blocks unmasked injection by overwrite;
// "thinking" is agy-specific and never injected, so it stays out of the set.
export const GENERIC_EFFORTS = ["high", "medium", "low"] as const

// --- Shared catalog core (V1 + V2) -----------------------------------------
// Both catalog shapes iterate the same (base, profile) expansion over the
// same grouped declared map, and both map a declared effort to the same
// `reasoningEffort`. Only the emitted shape differs, so that logic lives here
// once: V1 `buildModelMap` keeps its shape below, V2 `buildModelV2` emits
// `Model.Info[]`.

export const MODEL_PROFILES = ["ro", "rw"] as const

export type ModelProfile = (typeof MODEL_PROFILES)[number]

/** Catalog id for one grouped base under one profile. */
export function modelID(base: string, profile: ModelProfile): string {
  return `auto-${profile}-${base}`
}

/**
 * Declared effort -> opencode `reasoningEffort`. "thinking" is agy-specific
 * and is NOT a member of opencode's reasoningEffort enum (spike obs #101), so
 * it is advertised as "max"; `resolveWireModel` maps "max" back to "-thinking"
 * when, and only when, that base declares "thinking".
 */
export function reasoningEffortFor(effort: string): string {
  return effort === "thinking" ? "max" : effort
}

/**
 * Walks the shared catalog core: one entry per (base, profile) pair with its
 * declared efforts in *declared* (slug) order. Order is preserved because the
 * V1 map serializes `variants` in that order — sorting it here would change
 * the V1 output bytes.
 */
export function eachModelProfile(
  bases: Map<string, Set<string>>,
  emit: (entry: {
    id: string;
    base: string;
    profile: ModelProfile;
    efforts: readonly string[];
  }) => void,
): void {
  for (const [base, variants] of bases) {
    for (const profile of MODEL_PROFILES) {
      emit({ id: modelID(base, profile), base, profile, efforts: [...variants] });
    }
  }
}

export function buildModelMap(bases: Map<string, Set<string>>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  eachModelProfile(bases, ({ id, efforts }) => {
    const variantMap: Record<string, VariantSpec> = {}
    for (const v of efforts) {
      variantMap[v] = { reasoningEffort: reasoningEffortFor(v) }
    }
    if (efforts.length > 0) {
      for (const g of GENERIC_EFFORTS) {
        if (!(g in variantMap)) {
          variantMap[g] = { disabled: true }
        }
      }
    }
    out[id] = {
      id,
      name: id,
      provider: { id: "agy-bridge", name: "AGY Bridge" },
      ...(efforts.length > 0
        ? {
          reasoning: true as const,
          interleaved: { field: "reasoning_content" as const },
          reasoning_options: [...efforts].sort(),
        }
        : {}),
      variants: variantMap,
    }
  })
  return out
}

// --- OpenCode V2 catalog: Model.Info[] --------------------------------------
// Shape per https://opencode.ai/v2/docs/models and migrate-v1 "Models and
// variants":
// - `variants` is an ARRAY of `{id, settings}` (V1 object form is ignored by
//   V2 and warns).
// - V1 `tool_call`/`modalities` become `capabilities.{tools,input,output}`.
//   V2 `Model.Info` has no `reasoning` flag (migrate-v1 lists `reasoning` as
//   accepted-but-unsupported): a reasoning model is one that HAS variants.
// - V1 `interleaved: {field}` becomes `compatibility.reasoningField`.
// - V1 `reasoning_options` has no V2 equivalent: the variants array *is* the
//   declared truth (undeclared efforts are omitted, not masked).
// - `capabilities`/`limit` values are the fallbacks the V2 docs state for a
//   model absent from the catalog (tools, text+image in, text out, 200k
//   context, 32k output). The bridge does not advertise its own, and V2
//   requires both fields, so we pin the documented defaults instead of
//   letting them float.
// - `api` and `request` are provider/runtime owned and omitted.
// - `cost`/`time`/`status` are NOT optional in the OpenAPI `Model.Info` schema
//   (see ModelV2 below), even though migrate-v1 lists `release_date` and
//   `status` among accepted-but-unsupported V1 model fields: those are the V1
//   names. The V2 names (`time.released`, `cost[]`, `status`) are required, so
//   they are emitted explicitly rather than left to runtime defaults.

export const V2_PROVIDER_ID = "agy-bridge"
export const V2_REASONING_FIELD = "reasoning_content"

export type ModelVariantV2 = {
  id: string
  settings: { reasoningEffort: string }
}

/**
 * V2 `Model.Info` as required by the OpenAPI schema, NOT by the prose examples
 * on /v2/docs/models. `Model.Info` is `additionalProperties: false` and
 * `required: [id, modelID, providerID, name, capabilities, variants, time,
 * cost, status, enabled, limit]`.
 *
 * A shape built from the docs alone omits `modelID`/`time`/`status`/`cost` and
 * the runtime dies while sorting the catalog ("undefined is not an object
 * (evaluating '$H.time.released')"), which surfaces only as an opaque HTTP 500
 * from /api/model with zero models. Verified against opencode v2.0.20.
 */
export type ModelV2 = {
  id: string
  modelID: string
  providerID: string
  name: string
  enabled: boolean
  status: "active"
  capabilities: { tools: boolean; input: string[]; output: string[] }
  limit: { context: number; output: number }
  compatibility: { reasoningField: string }
  variants: ModelVariantV2[]
  // Unix ms. agy does not advertise a release date, so this is a fixed
  // catalog-ordering value, not a claim about the model. It must be present:
  // the runtime dereferences `time.released` unconditionally.
  time: { released: number }
  // agy exposes no pricing. Model.Cost requires input/output/cache, so an
  // explicit zero is the honest shape — the alternative is inventing prices.
  cost: Array<{ input: number; output: number; cache: { read: number; write: number } }>
}

const V2_CAPABILITIES: ModelV2["capabilities"] = {
  tools: true,
  input: ["text", "image"],
  output: ["text"],
}

const V2_LIMIT: ModelV2["limit"] = { context: 200_000, output: 32_000 }

/** Zero-priced tier: agy bills nothing we can read. See ModelV2.cost. */
const V2_COST: ModelV2["cost"] = [{
  input: 0,
  output: 0,
  cache: { read: 0, write: 0 },
}]

/**
 * Catalog ordering value for every agy model (2026-01-01T00:00:00Z). Not a
 * release-date claim; the runtime only needs it present and sortable.
 */
export const V2_RELEASED = 1_767_225_600_000

function v2Cost(): ModelV2["cost"] {
  return V2_COST.map((tier) => ({ ...tier, cache: { ...tier.cache } }))
}

/**
 * V2 model inventory: one `Model.Info` per (base, profile) with declared
 * efforts as a V2 variants array. Deterministic: sorted by id, and each
 * variants array sorted by variant id.
 */
export function buildModelV2(bases: Map<string, Set<string>>): ModelV2[] {
  const models: ModelV2[] = []
  eachModelProfile(bases, ({ id, efforts }) => {
    models.push({
      id,
      // agy resolves every entry path by the full suffixed slug, so the catalog
      // id and the wire model id are the same string.
      modelID: id,
      providerID: V2_PROVIDER_ID,
      name: id,
      enabled: true,
      status: "active",
      capabilities: { ...V2_CAPABILITIES, input: [...V2_CAPABILITIES.input], output: [...V2_CAPABILITIES.output] },
      limit: { ...V2_LIMIT },
      compatibility: { reasoningField: V2_REASONING_FIELD },
      time: { released: V2_RELEASED },
      cost: v2Cost(),
      variants: [...efforts].sort().map((effort) => ({
        id: effort,
        settings: { reasoningEffort: reasoningEffortFor(effort) },
      })),
    })
  })
  models.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return models
}

/**
 * Declared efforts per V2 model id, for the V2 masking transform.
 * Singletons map to an empty set: no declared effort, nothing selectable.
 */
export function declaredVariantsByModel(
  bases: Map<string, Set<string>>,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  eachModelProfile(bases, ({ id, efforts }) => out.set(id, new Set(efforts)))
  return out
}

/**
 * V2 effort masking. V1 emitted undeclared generic efforts as
 * `{disabled:true}` because it had to pre-populate them to win the runtime
 * merge. V2 has no documented variant-level disable flag and no
 * `reasoning_options` to intersect with, so masking is expressed as:
 * (1) omission — `buildModelV2` only emits declared efforts — plus
 * (2) this filter, applied from a `ctx.model.transform` so any variant the
 * runtime or another source unions in afterwards is dropped again.
 * `declared === undefined` means "id not in our declared map": pass through,
 * never silently empty someone else's model.
 */
export function filterUndeclaredVariants<T extends { id: string }>(
  variants: readonly T[] | undefined,
  declared: ReadonlySet<string> | undefined,
): T[] {
  if (!Array.isArray(variants)) return []
  if (!declared) return [...variants]
  return variants.filter((variant) => declared.has(variant.id))
}

export type DeltaKind = "agent_response" | "thought" | "tool" | "unknown"

export type NoteClassifierOptions = {
  chunk: (delta: Record<string, unknown>) => void
  log?: { delta_chars: number }
}

export function classifyLine(line: string): "reasoning_content" | "content" {
  return line.trimStart().startsWith("NOTE:") ? "reasoning_content" : "content"
}

export function createNoteClassifier(opts: NoteClassifierOptions): {
  onDelta(kind: DeltaKind, text: string): void
  flush(): void
} {
  let buffer = ""

  return {
    onDelta(kind: DeltaKind, text: string): void {
      if (!text) return
      if (opts.log) {
        opts.log.delta_chars += text.length
      }

      if (kind === "unknown") {
        console.error("unknown step_type:", kind, text)
        opts.chunk({ reasoning_content: text })
        return
      }

      if (kind === "thought" || kind === "tool") {
        opts.chunk({ reasoning_content: text })
        return
      }

      // kind === "agent_response" -> line buffered
      buffer += text
      let newlineIdx = buffer.indexOf("\n")
      while (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx + 1)
        buffer = buffer.slice(newlineIdx + 1)
        const field = classifyLine(line)
        opts.chunk({ [field]: line })
        newlineIdx = buffer.indexOf("\n")
      }
    },

    flush(): void {
      if (buffer.length > 0) {
        opts.chunk({ content: buffer })
        buffer = ""
      }
    },
  }
}

// Narration disclosure (bridge-live-thoughts Phase 6): live test showed the
// NOTE instruction makes intermediate agent_response deltas emit live.
// Canonical consumer is handleAutonomousChat's streaming branch in
// agy-bridge.ts, which statically imports this constant as the single source of truth.
export const NARRATION_SUFFIX =
  "IMPORTANT: before every tool call, first emit one short line starting with NOTE: explaining what you are about to do and why. Keep each NOTE to one sentence."

export function applyNarrationSuffix(prompt: string, stream: boolean): string {
  return stream === true ? prompt + NARRATION_SUFFIX : prompt
}

