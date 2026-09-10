/**
 * agy-bridge — OpenCode plugin entrypoint
 * Source of truth for models and grouping is agy-bridge-helpers.ts.
 * This file is bundled via `deno task bundle:plugin` into plugins/agy-bridge.ts.
 *
 * No client-side request rewriting: every entry path (TUI, direct, subagent,
 * SDD provider) sends the model id verbatim and the bridge validates it via
 * resolveWireModel (fail-closed 400 naming available suffixed slugs).
 */
import type { Plugin } from "@opencode-ai/plugin";
import {
  buildModelMap,
  FALLBACK_MODELS,
  groupBases,
  MODEL_MAP_VERSION,
} from "./agy-bridge-helpers.ts";

export { buildModelMap, FALLBACK_MODELS, groupBases, MODEL_MAP_VERSION };

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

const AgyBridgePlugin: Plugin = (_input) => {
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
  });
};

export default AgyBridgePlugin;
