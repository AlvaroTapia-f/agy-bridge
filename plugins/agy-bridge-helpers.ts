// LOCKSTEP:plugin-4pass-live
export const FALLBACK_MODELS = [
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

export type VariantSpec = { reasoningEffort: string }

export function buildModelMap(bases: Map<string, Set<string>>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [base, variants] of bases) {
    for (const profile of ["ro", "rw"] as const) {
      const id = `auto-${profile}-${base}`
      const variantMap: Record<string, VariantSpec> = {}
      for (const v of variants) variantMap[v] = { reasoningEffort: v }
      out[id] = {
        id,
        name: id,
        provider: { id: "agy-bridge", name: "AGY Bridge" },
        ...(variants.size ? { capabilities: { reasoning: true as const } } : {}),
        variants: variantMap,
      }
    }
  }
  return out
}

export type DeltaKind = "agent_response" | "thought" | "tool" | "unknown"

export function formatDeltaChunk(
  kind: DeltaKind,
  text: string,
): Record<string, unknown> {
  return kind === "agent_response"
    ? { content: text }
    : { reasoning_content: text }
}

export function onDeltaHandler(
  kind: DeltaKind,
  delta: string,
  chunk: (payload: Record<string, unknown>) => void,
  log?: { delta_chars: number },
): void {
  if (!delta) return
  if (log) {
    log.delta_chars += delta.length
  }
  chunk(formatDeltaChunk(kind, delta))
}

// Narration disclosure (bridge-live-thoughts Phase 6): live test showed the
// NOTE instruction makes intermediate agent_response deltas emit live.
// Canonical consumer is handleAutonomousChat's streaming branch in
// agy-bridge.ts, which inlines the identical literal to stay import-free
// under the systemd unit's scoped --allow-read. Keep both copies in sync.
export const NARRATION_SUFFIX =
  "IMPORTANT: before every tool call, first emit one short line starting with NOTE: explaining what you are about to do and why. Keep each NOTE to one sentence."

export function applyNarrationSuffix(prompt: string, stream: boolean): string {
  return stream === true ? prompt + NARRATION_SUFFIX : prompt
}

