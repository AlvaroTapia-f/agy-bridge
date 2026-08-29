export type ProviderHook = {
  id: string;
  models?: (provider: any, ctx: any) => Promise<Record<string, any>>;
};
export type AuthHook = {
  provider: string;
  loader?: (auth: any, provider: any) => Promise<Record<string, any>>;
  methods: Array<{ type: string; label: string }>;
};
export type PluginInput = {
  client: any;
  project: any;
  directory: string;
  worktree: string;
};
export type Plugin = (input: PluginInput, options?: any) => Promise<{
  auth?: AuthHook;
  provider?: ProviderHook;
  [k: string]: unknown;
}>;
