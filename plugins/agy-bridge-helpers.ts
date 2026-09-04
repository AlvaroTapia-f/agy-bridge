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
        ...(variants.size
          ? {
              reasoning: true as const,
              interleaved: { field: "reasoning_content" as const },
            }
          : {}),
        variants: variantMap,
      }
    }
  }
  return out
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

