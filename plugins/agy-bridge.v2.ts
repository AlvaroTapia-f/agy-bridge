/**
 * agy-bridge — OpenCode V2 plugin entrypoint.
 *
 * V1 stays untouched in plugins/agy-bridge.plugin.ts (function export,
 * `{auth, provider.models}` from "@opencode-ai/plugin", bundled into
 * plugins/agy-bridge.ts). This file is the V2 counterpart per
 * https://opencode.ai/v2/docs/build/plugins (+ migrate-v1: auth →
 * ctx.integration.transform, provider → ctx.provider.transform).
 *
 * Model catalog source of truth is plugins/agy-bridge-helpers.ts.
 * Slugs are preloaded from the live bridge (GET 127.0.0.1:7421/v1/models)
 * with FALLBACK_MODELS as fallback BEFORE registering the provider
 * transform; later catalog changes re-register via ctx.provider.reload().
 *
 * NOTE (T2 owns the full port): variants are emitted as a V2 array
 * ({id, settings.reasoningEffort}); no V1 `variants` object, no
 * `reasoning`/`interleaved` keys. Capabilities/disabled mapping lands in T2.
 */
import { Plugin } from "@opencode/plugin";
import type { ModelInfo, ProviderInfo } from "@opencode/plugin";
import { FALLBACK_MODELS, groupBases } from "./agy-bridge-helpers.ts";

export const PROVIDER_ID = "agy-bridge";
export const BRIDGE_MODELS_URL = "http://127.0.0.1:7421/v1/models";
export const BRIDGE_BASE_URL = "http://127.0.0.1:7421/v1";

export async function resolveSlugs(authKey?: string): Promise<string[]> {
  try {
    const headers: Record<string, string> = {};
    if (authKey) headers["Authorization"] = `Bearer ${authKey}`;
    const res = await fetch(BRIDGE_MODELS_URL, { headers });
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

function extractKey(credential: unknown): string | undefined {
  if (typeof credential === "string" && credential) return credential;
  if (typeof credential === "object" && credential !== null) {
    const rec = credential as Record<string, unknown>;
    for (const k of ["key", "apiKey", "token"]) {
      if (typeof rec[k] === "string" && (rec[k] as string)) {
        return rec[k] as string;
      }
    }
  }
  return undefined;
}

/**
 * Builds the V2 model inventory from bridge slugs: one entry per
 * auto-ro/auto-rw profile over each grouped base, variants as a V2 array.
 */
export function buildV2Models(slugs: readonly string[]): ModelInfo[] {
  const grouped = groupBases(slugs);
  const models: ModelInfo[] = [];
  for (const [base, variants] of grouped) {
    for (const profile of ["ro", "rw"] as const) {
      const id = `auto-${profile}-${base}`;
      models.push({
        id,
        name: id,
        variants: [...variants].sort().map((v) => ({
          id: v,
          settings: { reasoningEffort: v === "thinking" ? "max" : v },
        })),
      });
    }
  }
  models.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return models;
}

export function providerInfo(): ProviderInfo {
  return {
    id: PROVIDER_ID,
    name: "AGY Bridge",
    activation: "enabled",
    package: "@opencode/ai/providers/openai-compatible",
    settings: { baseURL: BRIDGE_BASE_URL },
  };
}

const plugin = Plugin.define({
  id: PROVIDER_ID,
  async setup(ctx) {
    const state: { slugs: string[] } = { slugs: [...FALLBACK_MODELS] };

    const loadSlugs = async (): Promise<void> => {
      let key: string | undefined;
      try {
        const connection = await ctx.integration.connection.active(
          PROVIDER_ID,
        );
        if (connection) {
          const credential = await ctx.integration.connection.resolve(
            connection,
          );
          key = extractKey(credential);
        }
      } catch {
        key = undefined;
      }
      state.slugs = await resolveSlugs(key);
    };

    // Preload live catalog before registering the transform so the first
    // provider read already reflects the bridge (fallback when down).
    await loadSlugs();

    await ctx.integration.transform((editor) => {
      editor.method.update({
        integrationID: PROVIDER_ID,
        method: {
          id: "api",
          type: "api-key",
          label: "AGY Token (paste from ~/.config/agy-bridge/env)",
        },
      });
    });

    await ctx.provider.transform((editor) => {
      editor.add({ info: providerInfo(), models: buildV2Models(state.slugs) });
    });

    const refresh = async (): Promise<void> => {
      await loadSlugs();
      await ctx.provider.reload();
    };

    const timer = setInterval(() => {
      void refresh().catch((err) => console.error("[agy-bridge.v2] refresh:", err));
    }, 60_000);

    return () => clearInterval(timer);
  },
});

export default plugin;
