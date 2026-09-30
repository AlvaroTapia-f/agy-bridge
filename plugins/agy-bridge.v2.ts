/**
 * agy-bridge — OpenCode V2 plugin entrypoint.
 *
 * V1 stays untouched in plugins/agy-bridge.plugin.ts (function export,
 * `{auth, provider.models}` from "@opencode-ai/plugin", bundled into
 * plugins/agy-bridge.ts). This file is the V2 counterpart per
 * https://opencode.ai/v2/docs/build/plugins (+ migrate-v1: auth →
 * ctx.integration.transform, provider → ctx.provider.transform).
 *
 * Model catalog source of truth is plugins/agy-bridge-helpers.ts: buildModelV2
 * emits the V2 `Model.Info[]` (variants as an array, capabilities instead of
 * `reasoning`, compatibility.reasoningField instead of `interleaved`) from the
 * same grouped declared map the V1 bundle uses.
 * Slugs are preloaded from the live bridge (GET 127.0.0.1:7421/v1/models)
 * with FALLBACK_MODELS as fallback BEFORE registering the provider
 * transform; later catalog changes re-register via ctx.provider.reload() and
 * ctx.model.reload().
 */
import { Plugin } from "@opencode/plugin";
import type { ModelInfo, PluginContext, ProviderInfo } from "@opencode/plugin";
import {
  buildModelV2,
  declaredVariantsByModel,
  FALLBACK_MODELS,
  filterUndeclaredVariants,
  groupBases,
} from "./agy-bridge-helpers.ts";

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
 * Builds the V2 model inventory from bridge slugs: one `Model.Info` per
 * auto-ro/auto-rw profile over each grouped base, variants as a V2 array of
 * `{id, settings.reasoningEffort}`. Thin slug-level wrapper over the shared
 * helper builder so V1 and V2 read the same declared map.
 */
export function buildV2Models(slugs: readonly string[]): ModelInfo[] {
  return buildModelV2(groupBases(slugs));
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
    const state: { slugs: string[]; declared: Map<string, Set<string>> } = {
      slugs: [...FALLBACK_MODELS],
      declared: declaredVariantsByModel(groupBases(FALLBACK_MODELS)),
    };

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
      state.declared = declaredVariantsByModel(groupBases(state.slugs));
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

    // V2 effort masking (replaces V1's {disabled:true} entries, which V2 has
    // no flag for): keep every agy-bridge model on its declared efforts, so a
    // variant the runtime or another source unions in cannot reach the picker
    // and the bridge's fail-closed resolveWireModel. Pure, replayable, and
    // driven by `state.declared`, hence the extra ctx.model.reload() below.
    await ctx.model.transform((editor) => {
      for (const model of editor.list(PROVIDER_ID)) {
        const allowed = state.declared.get(model.id);
        if (!allowed || !Array.isArray(model.variants)) continue;
        const kept = filterUndeclaredVariants(model.variants, allowed);
        if (kept.length === model.variants.length) continue;
        editor.update(PROVIDER_ID, model.id, (draft) => {
          draft.variants = kept;
        });
      }
    });

    const refresh = async (): Promise<void> => {
      await loadSlugs();
      await ctx.provider.reload();
      await ctx.model.reload();
    };

    const timer = setInterval(() => {
      void refresh().catch((err) => console.error("[agy-bridge.v2] refresh:", err));
    }, refreshIntervalMs(ctx));

    return () => clearInterval(timer);
  },
});

/**
 * Catalog poll period. `refreshIntervalMs` is a plugin option (V2 passes
 * `plugins[].options` into `ctx.options`); anything non-numeric or
 * non-positive falls back to REFRESH_INTERVAL_MS.
 */
export const REFRESH_INTERVAL_MS = 60_000;

export function refreshIntervalMs(ctx: PluginContext): number {
  const requested = ctx.options?.refreshIntervalMs;
  return typeof requested === "number" && requested > 0
    ? requested
    : REFRESH_INTERVAL_MS;
}

export default plugin;
