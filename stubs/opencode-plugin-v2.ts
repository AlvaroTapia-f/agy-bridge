/**
 * Local type-shim for "@opencode/plugin" (OpenCode V2 plugin API).
 *
 * Mapped in deno.json so `deno task test` resolves the per-docs V2 import
 * without the real package installed. Shapes follow
 * https://opencode.ai/v2/docs/build/plugins (+ migrate-v1: auth →
 * ctx.integration.transform, provider → ctx.provider.transform).
 *
 * The real package takes precedence when installed in an OpenCode V2
 * runtime; this shim only carries the surface agy-bridge uses.
 */

export type ModelVariantInfo = {
  id: string;
  settings?: Record<string, unknown>;
  [k: string]: unknown;
};

export type ModelInfo = {
  id: string;
  name: string;
  variants?: ModelVariantInfo[];
  [k: string]: unknown;
};

// Model transforms hand out editable drafts of the same definition shape
// (the V2 docs call them `DeepMutable<Model.Info>`), so the shim keeps the
// index signature and lets a transform assign `variants`.
export type DeepMutableModelInfo = {
  id: string;
  providerID?: string;
  name: string;
  variants?: ModelVariantInfo[];
  [k: string]: unknown;
};

export type ProviderInfo = {
  id: string;
  name?: string;
  [k: string]: unknown;
};

export type IntegrationMethod = {
  id: string;
  [k: string]: unknown;
};

export type ConnectionInfo = {
  [k: string]: unknown;
};

export type CredentialValue = unknown;

export type ProviderEditor = {
  add(input: {
    info: ProviderInfo;
    models: readonly ModelInfo[];
    sourceConnection?: ConnectionInfo;
  }): void;
};

export type ProviderRegistration = {
  dispose(): Promise<void>;
};

export type ProviderDomain = {
  transform(
    callback: (editor: ProviderEditor) => void,
  ): Promise<ProviderRegistration>;
  reload(): Promise<void>;
};

export type ModelEditor = {
  list(providerID?: string): readonly DeepMutableModelInfo[];
  get(
    providerID: string,
    modelID: string,
  ): DeepMutableModelInfo | undefined;
  update(
    providerID: string,
    modelID: string,
    update: (model: DeepMutableModelInfo) => void,
  ): void;
  remove(providerID: string, modelID: string): void;
};

export type ModelDomain = {
  transform(
    callback: (editor: ModelEditor) => void,
  ): Promise<ProviderRegistration>;
  reload(): Promise<void>;
};

export type IntegrationMethodEditor = {
  list(integrationID: string): readonly IntegrationMethod[];
  update(input: { integrationID: string; method: IntegrationMethod }): void;
  remove(integrationID: string, method: IntegrationMethod): void;
};

export type IntegrationEditor = {
  method: IntegrationMethodEditor;
};

export type IntegrationDomain = {
  transform(
    callback: (editor: IntegrationEditor) => void,
  ): Promise<ProviderRegistration>;
  reload(): Promise<void>;
  connection: {
    active(integrationID: string): Promise<ConnectionInfo | undefined>;
    resolve(connection: ConnectionInfo): Promise<CredentialValue | undefined>;
  };
};

export type PluginContext = {
  integration: IntegrationDomain;
  provider: ProviderDomain;
  model: ModelDomain;
  options: Record<string, unknown>;
  [k: string]: unknown;
};

export type PluginCleanup = () => void | Promise<void>;

export type PluginDefinition = {
  id: string;
  setup: (ctx: PluginContext) => Promise<PluginCleanup | void> | PluginCleanup | void;
};

export const Plugin = {
  define(def: PluginDefinition): PluginDefinition {
    return def;
  },
};
