/**
 * agy-bridge — OpenCode plugin entrypoint
 * Source of truth for models and grouping is agy-bridge-helpers.ts.
 * This file is bundled via `deno task bundle:plugin` into plugins/agy-bridge.ts.
 */
import type { Plugin } from "@opencode-ai/plugin";
import {
  buildModelMap,
  EFFORT_SUFFIXES,
  FALLBACK_MODELS,
  groupBases,
  wireModel,
} from "./agy-bridge-helpers.ts";

export { buildModelMap, FALLBACK_MODELS, groupBases };

type ModelV2 = Record<string, unknown> & {
  id: string;
  name: string;
  variants?: Record<string, unknown>;
  provider?: { id: string; name: string };
  reasoning?: boolean;
  interleaved?: { field: string };
};
type ProviderV2 = Record<string, unknown> & { id: string };

async function resolveSlugs(authKey?: string): Promise<string[]> {
  try {
    const headers: Record<string, string> = {};
    if (authKey) headers["Authorization"] = `Bearer ${authKey}`;
    const res = await fetch("http://127.0.0.1:7421/v1/models", { headers });
    if (!res.ok) throw new Error(`GET /v1/models ${res.status}`);
    const data = (await res.json()) as {
      object?: string;
      data?: Array<{ id: string }>;
    };
    const ids = (data.data ?? []).map((m) => m.id).filter(Boolean);
    if (ids.length) return ids;
    throw new Error("empty");
  } catch {
    return [...FALLBACK_MODELS];
  }
}

const FALLBACK_GROUPED = groupBases([...FALLBACK_MODELS]);

// variant picked in TUI via chat.message hook (opencode does NOT send variant in fetch body)
const variantByModel = new Map<string, string>();

function defaultVariantForBase(base: string): string | undefined {
  const variants = FALLBACK_GROUPED.get(base);
  if (!variants || variants.size === 0) return undefined;
  if (variants.has("medium")) return "medium";
  if (variants.has("high")) return "high";
  if (variants.has("low")) return "low";
  if (variants.has("thinking")) return "thinking";
  return Array.from(variants)[0];
}

function installFetchWrapper(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  if (g.__agy_bridge_fetch_patched) return;
  g.__agy_bridge_fetch_patched = true;
  const origFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    try {
      const urlStr = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : (input as Request).url ?? String(input);
      const isTarget = urlStr.includes("127.0.0.1:7421/v1/chat/completions") ||
        urlStr.includes("localhost:7421/v1/chat/completions") ||
        urlStr.includes("127.0.0.1:7421/chat/completions") ||
        urlStr.includes("localhost:7421/chat/completions");
      if (isTarget) {
        let bodyStr: string | undefined;
        let bodyObj: Record<string, unknown> | undefined;
        let isRequestBody = false;
        if (init?.body && typeof init.body === "string") {
          bodyStr = init.body as string;
        } else if (input instanceof Request) {
          try {
            const cloned = (input as Request).clone();
            bodyStr = await cloned.text();
            isRequestBody = true;
          } catch {
            bodyStr = undefined;
          }
        }
        if (bodyStr) {
          try {
            bodyObj = JSON.parse(bodyStr) as Record<string, unknown>;
          } catch {
            bodyObj = undefined;
          }
        }
        if (bodyObj && typeof bodyObj === "object") {
          const modelRaw = String(bodyObj.model ?? "");
          const variantRaw = bodyObj.variant
            ? String(bodyObj.variant)
            : undefined;
          // Prefer variant from body (if ever sent), else from chat.message hook storage, else default
          const storedVariant = variantByModel.get(modelRaw) ||
            (typeof bodyObj.model === "string"
              ? variantByModel.get(String(bodyObj.model))
              : undefined);
          const effectiveVariant = variantRaw && variantRaw !== "default"
            ? variantRaw
            : storedVariant;
          let shouldRewrite = false;
          let wired: string | undefined;
          if (effectiveVariant && effectiveVariant !== "default") {
            // variant picker supplied (via body or stored) -> suffix via wireModel
            wired = wireModel(modelRaw, effectiveVariant);
            shouldRewrite = true;
          } else {
            // no variant at all -> check if model is bare auto-ro/rw-<base> that needs default suffix
            const match = modelRaw.match(/^auto-(ro|rw)-(.+)$/);
            if (match) {
              const basePart = match[2];
              const hasSuffix = EFFORT_SUFFIXES.some((s) =>
                basePart.endsWith(`-${s}`)
              );
              if (!hasSuffix) {
                const def = defaultVariantForBase(basePart);
                if (def) {
                  wired = wireModel(modelRaw, def);
                  shouldRewrite = true;
                }
              }
            }
          }
          if (shouldRewrite && wired) {
            bodyObj.model = wired;
            if ("variant" in bodyObj) delete bodyObj.variant;
            const newBody = JSON.stringify(bodyObj);
            if (isRequestBody && input instanceof Request) {
              const newReq = new Request((input as Request).url, {
                method: (input as Request).method,
                headers: (input as Request).headers,
                body: newBody,
              });
              return origFetch(newReq as unknown as RequestInfo, init);
            } else if (init) {
              const newInit: RequestInit = { ...init, body: newBody };
              if (newInit.headers) {
                const h = new Headers(newInit.headers as HeadersInit);
                h.delete("content-length");
                newInit.headers = h;
              }
              return origFetch(input, newInit);
            } else {
              return origFetch(input, {
                method: "POST",
                body: newBody,
                headers: { "content-type": "application/json" },
              });
            }
          }
        }
      }
    } catch (_err) {
      // Fall through to origFetch if JSON inspection fails
    }
    return origFetch(input as RequestInfo, init);
  }) as typeof globalThis.fetch;
}

const AgyBridgePlugin: Plugin = (_input) => {
  installFetchWrapper();
  return Promise.resolve({
    auth: {
      provider: "agy-bridge",
      loader: (auth) => {
        if (auth?.type === "api" && (auth as { key?: string }).key) {
          return Promise.resolve({ apiKey: (auth as { key: string }).key });
        }
        return Promise.resolve({});
      },
      methods: [{
        type: "api",
        label: "AGY Token (paste from ~/.config/agy-bridge/env)",
      }],
    },
    provider: {
      id: "agy-bridge",
      models: async (
        _provider: ProviderV2,
        ctx: { auth?: { key?: string } & Record<string, unknown> },
      ) => {
        const key = (ctx.auth as { key?: string } | undefined)?.key;
        const slugs = await resolveSlugs(key);
        const grouped = groupBases(slugs);
        return buildModelMap(grouped) as Record<string, ModelV2>;
      },
    },
    "chat.message": (
      input: {
        sessionID: string;
        model?: { providerID: string; modelID: string };
        variant?: string;
      },
    ) => {
      try {
        if (input.variant && input.model?.modelID) {
          variantByModel.set(input.model.modelID, input.variant);
        }
      } catch (_err) {
        // Ignore errors caching model variant
      }
      return Promise.resolve();
    },
  });
};

export default AgyBridgePlugin;
