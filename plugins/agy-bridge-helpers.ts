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
] as const

export const EFFORT_SUFFIXES = ["high", "medium", "low", "thinking"] as const

export function stripEffortSuffix(slug: string): { base: string; variant?: string } {
  for (const suffix of EFFORT_SUFFIXES) {
    const needle = `-${suffix}`
    if (slug.endsWith(needle)) {
      return { base: slug.slice(0, -needle.length), variant: suffix }
    }
  }
  return { base: slug }
}

export function groupBases(slugs: readonly string[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const slug of slugs) {
    const { base, variant } = stripEffortSuffix(slug)
    if (!map.has(base)) map.set(base, new Set<string>())
    if (variant) map.get(base)!.add(variant)
  }
  return map
}

export function wireModel(base: string, variant?: string): string {
  return variant ? `${base}-${variant}` : base
}

export function buildModelMap(bases: Map<string, Set<string>>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [base, variants] of bases) {
    for (const profile of ["ro", "rw"] as const) {
      const id = `auto-${profile}-${base}`
      const variantMap: Record<string, { disabled?: boolean }> = {}
      for (const v of variants) variantMap[v] = {}
      out[id] = {
        id,
        name: id,
        provider: { id: "agy-bridge", name: "AGY Bridge" },
        variants: variantMap,
      }
    }
  }
  return out
}
