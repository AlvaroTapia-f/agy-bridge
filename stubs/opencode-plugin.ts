import type { Auth, Provider } from "./opencode-sdk-v2.ts";

export type ProviderHook = {
  id: string;
  models?: (
    provider: Provider,
    ctx: { auth?: Auth; [k: string]: unknown },
  ) => Promise<Record<string, unknown>>;
};
export type AuthHook = {
  provider: string;
  loader?: (
    auth: Auth | undefined,
    provider: Provider,
  ) => Promise<Record<string, unknown>>;
  methods: Array<{ type: string; label: string }>;
};
export type PluginInput = {
  client: unknown;
  project: unknown;
  directory: string;
  worktree: string;
};
export type Plugin = (
  input: PluginInput,
  options?: Record<string, unknown>,
) => Promise<{
  auth?: AuthHook;
  provider?: ProviderHook;
  [k: string]: unknown;
}>;
