/**
 * agy-bridge — OpenCode plugin (self-contained, no helper exports for loader)
 */
import type { Plugin } from "@opencode-ai/plugin"
type ModelV2 = Record<string, unknown> & { id: string; name: string; variants?: Record<string, unknown> }
type ProviderV2 = Record<string, unknown> & { id: string }

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
] as const

const EFFORT_SUFFIXES = ["high", "medium", "low", "thinking"] as const

function stripEffortSuffix(
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

function wireModel(base: string, variant?: string): string {
  return variant ? `${base}-${variant}` : base
}

type VariantSpec = { reasoningEffort: string }

function buildModelMap(bases: Map<string, Set<string>>): Record<string, ModelV2> {
  const out: Record<string, ModelV2> = {}
  for (const [base, variants] of bases) {
    for (const profile of ["ro", "rw"] as const) {
      const id = `auto-${profile}-${base}`
      const variantMap: Record<string, VariantSpec> = {}
      for (const v of variants) variantMap[v] = { reasoningEffort: v }
      out[id] = {
        id,
        name: id,
        provider: { id: "agy-bridge", name: "AGY Bridge" } as unknown as ModelV2["provider"],
        ...(variants.size ? { capabilities: { reasoning: true as const } } : {}),
        variants: variantMap,
      } as unknown as ModelV2
    }
  }
  return out
}

async function resolveSlugs(authKey?: string): Promise<string[]> {
  try {
    const headers: Record<string, string> = {}
    if (authKey) headers["Authorization"] = `Bearer ${authKey}`
    const res = await fetch("http://127.0.0.1:7421/v1/models", { headers })
    if (!res.ok) throw new Error(`GET /v1/models ${res.status}`)
    const data = (await res.json()) as { object?: string; data?: Array<{ id: string }> }
    const ids = (data.data ?? []).map((m) => m.id).filter(Boolean)
    if (ids.length) return ids
    throw new Error("empty")
  } catch {
    return [...FALLBACK_MODELS]
  }
}

const FALLBACK_GROUPED = groupBases([...FALLBACK_MODELS])

// variant picked in TUI via chat.message hook (opencode does NOT send variant in fetch body)
const variantByModel = new Map<string, string>()
const variantBySession = new Map<string, string>()

function defaultVariantForBase(base: string): string | undefined {
  const variants = FALLBACK_GROUPED.get(base)
  if (!variants || variants.size === 0) return undefined
  if (variants.has("medium")) return "medium"
  if (variants.has("high")) return "high"
  if (variants.has("low")) return "low"
  if (variants.has("thinking")) return "thinking"
  return Array.from(variants)[0]
}

function installFetchWrapper(): void {
  const g = globalThis as unknown as Record<string, unknown>
  if (g.__agy_bridge_fetch_patched) return
  g.__agy_bridge_fetch_patched = true
  const origFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      const urlStr =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url ?? String(input)
      const isTarget =
        urlStr.includes("127.0.0.1:7421/v1/chat/completions") ||
        urlStr.includes("localhost:7421/v1/chat/completions") ||
        urlStr.includes("127.0.0.1:7421/chat/completions") ||
        urlStr.includes("localhost:7421/chat/completions")
      if (isTarget) {
        let bodyStr: string | undefined
        let bodyObj: Record<string, unknown> | undefined
        let isRequestBody = false
        if (init?.body && typeof init.body === "string") {
          bodyStr = init.body as string
        } else if (input instanceof Request) {
          try {
            const cloned = (input as Request).clone()
            bodyStr = await cloned.text()
            isRequestBody = true
          } catch {
            bodyStr = undefined
          }
        }
        if (bodyStr) {
          try {
            bodyObj = JSON.parse(bodyStr) as Record<string, unknown>
          } catch {
            bodyObj = undefined
          }
        }
        if (bodyObj && typeof bodyObj === "object") {
          const modelRaw = String(bodyObj.model ?? "")
          const variantRaw = bodyObj.variant ? String(bodyObj.variant) : undefined
          // Prefer variant from body (if ever sent), else from chat.message hook storage, else default
          const storedVariant = variantByModel.get(modelRaw) || (typeof bodyObj.model === "string" ? variantByModel.get(String(bodyObj.model)) : undefined)
          const effectiveVariant = variantRaw && variantRaw !== "default" ? variantRaw : storedVariant
          let shouldRewrite = false
          let wired: string | undefined
          if (effectiveVariant && effectiveVariant !== "default") {
            // variant picker supplied (via body or stored) -> suffix via wireModel
            wired = wireModel(modelRaw, effectiveVariant)
            shouldRewrite = true
          } else {
            // no variant at all -> check if model is bare auto-ro/rw-<base> that needs default suffix
            const match = modelRaw.match(/^auto-(ro|rw)-(.+)$/)
            if (match) {
              const basePart = match[2]
              const hasSuffix = EFFORT_SUFFIXES.some((s) => basePart.endsWith(`-${s}`))
              if (!hasSuffix) {
                const def = defaultVariantForBase(basePart)
                if (def) {
                  wired = wireModel(modelRaw, def)
                  shouldRewrite = true
                }
              }
            }
          }
          if (shouldRewrite && wired) {
            bodyObj.model = wired
            if ("variant" in bodyObj) delete bodyObj.variant
            const newBody = JSON.stringify(bodyObj)
            if (isRequestBody && input instanceof Request) {
              const newReq = new Request((input as Request).url, {
                method: (input as Request).method,
                headers: (input as Request).headers,
                body: newBody,
              })
              return origFetch(newReq as unknown as RequestInfo, init)
            } else if (init) {
              const newInit: RequestInit = { ...init, body: newBody }
              if (newInit.headers) {
                const h = new Headers(newInit.headers as HeadersInit)
                h.delete("content-length")
                newInit.headers = h
              }
              return origFetch(input, newInit)
            } else {
              return origFetch(input, { method: "POST", body: newBody, headers: { "content-type": "application/json" } })
            }
          }
        }
      }
    } catch {}
    return origFetch(input as RequestInfo, init)
  }) as typeof globalThis.fetch
}

const AgyBridgePlugin: Plugin = async (_input) => {
  installFetchWrapper()
  return {
    auth: {
      provider: "agy-bridge",
      loader: async (auth) => {
        if (auth?.type === "api" && (auth as { key?: string }).key) {
          return { apiKey: (auth as { key: string }).key }
        }
        return {}
      },
      methods: [{ type: "api", label: "AGY Token (paste from ~/.config/agy-bridge/env)" }],
    },
    provider: {
      id: "agy-bridge",
      models: async (_provider: ProviderV2, ctx: { auth?: { key?: string } & Record<string, unknown> }) => {
        const key = (ctx.auth as { key?: string } | undefined)?.key
        const slugs = await resolveSlugs(key)
        const grouped = groupBases(slugs)
        return buildModelMap(grouped)
      },
    },
    "chat.message": async (input: { sessionID: string; model?: { providerID: string; modelID: string }; variant?: string }) => {
      try {
        if (input.variant && input.model?.modelID) {
          variantByModel.set(input.model.modelID, input.variant)
          if (input.sessionID) variantBySession.set(input.sessionID, input.variant)
        }
      } catch {}
    },
  }
}

export default AgyBridgePlugin
