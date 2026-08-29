export type Model = {
  id: string;
  name: string;
  provider?: { id: string; name: string };
  variants?: Record<string, { disabled?: boolean }>;
  [k: string]: unknown;
};
export type Provider = {
  id: string;
  [k: string]: unknown;
};
export type Auth = {
  type: string;
  key?: string;
  [k: string]: unknown;
};
