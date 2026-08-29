# Design: custom-opencode-provider-agy-bridge

## Technical Approach

Global OpenAI-compatible provider `agy-bridge` with ONLY `auto-ro-*`/`auto-rw-*` bases, each ONE id + `variants` for effort. Plugin dynamically builds `provider.agy-bridge.models` from `GET /v1/models` (TSV or `FALLBACK_MODELS`), groups by effort suffix, and rewrites `POST /v1/chat/completions` `model` to suffixed wire id validated by `modelSlugs`/`parseAutoModel`. Auth per-request `Bearer AGY_TOKEN` from `auth.json` (`/connect Other → agy-bridge`, `type:api` 600; alt `"{env:AGY_TOKEN}"`). `baseURL http://127.0.0.1:7421/v1`, `Host` matches `accessGuard`. No `agy-bridge.ts`/Deno permission changes.

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Plugin rewrite vs bridge `variant` header | Plugin keeps OpenAI contract, no `parseAutoModel` change; bridge patch diverges, couples to `Host` guard | **Plugin** — fits 400-line budget |
| `fetch` wrapper vs `chat.params` hook | `chat.params` cannot mutate `model` id; no `chat.model` hook in `@opencode-ai/plugin` v1.2 | **fetch wrapper** scoped to `7421/v1` (proven in zenmux/observer plugins) |
| Static `models` map vs dynamic `provider` hook | Static drifts from TSV, manual 28 ids; dynamic auto-syncs | **Dynamic** — 14→28 fallback |
| Flat `-high` ids vs `variants` map | Flat: 28 entries, no picker, spec violation | **Variants** — one base, subset picker |

Base extraction strips `{-high,-medium,-low,-thinking}` grouping: `gemini-3.7-flash-{high,medium,low}`→`{high,medium,low}`, `gemini-3.1-pro-{high,low}`→`{high,low}`, singletons (`claude-sonnet-4-6` etc.)→no variants.

## Data Flow

```
opencode TUI  ── variant picker (high) ─┐
     │                                   │
     ▼                                   │
~/.config/opencode/opencode.json         │
  provider.agy-bridge {baseURL, npm}     │
     │                                   │
     ▼                                   │
Plugin (~/.config/opencode/plugins/agy-bridge.ts)
  ├─ provider hook: GET /v1/models → modelSlugs → auto-ro/rw × bases → models.variants map
  └─ fetch wrapper: if url∈7421/v1 && variant≠default → body.model = "auto-ro-<base>-<variant>"
     │  Authorization: Bearer <AGY_TOKEN> (from auth.json)
     │  Host: 127.0.0.1:7421
     ▼
agy-bridge Deno.serve 127.0.0.1:7421
  accessGuard (Host + Bearer) → parseAutoModel → runAgy(realModel) → agy binary
```

Variant translation: `auto-ro-gemini-3.7-flash / high` → wire `"auto-ro-gemini-3.7-flash-high"` → `parseAutoModel` validates `real` vs `modelSlugs`. No variant → verbatim.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `~/.config/opencode/opencode.json` | Modify | Add `provider.agy-bridge` (`npm:"@ai-sdk/openai-compatible"`, `baseURL:"http://127.0.0.1:7421/v1"`) + `plugin` entry, no inline `models` |
| `~/.config/opencode/plugins/agy-bridge.ts` | Create | Provider hook + fetch-wrapper + `auth` hook (`type:api`) |
| `~/.local/share/opencode/auth.json` | Modify | `agy-bridge: {type:"api", key:"<AGY_TOKEN>"}` via `/connect` (600); alt `"{env:AGY_TOKEN}"` |
| `~/.config/agy-bridge/env` | None | Source of token (600), unchanged |
| `agy-bridge.ts` | None | No permission change (`--allow-net=127.0.0.1 --allow-run --allow-env` unchanged) |
| `install.sh` / `README.md` | Modify | Doc global provider + verification (`curl`/`opencode models`) |

## Interfaces / Contracts

```ts
type ProviderHook = { id:"agy-bridge"; models:(p,ctx:{auth?:Auth})=>Promise<Record<string, ModelV2>> }
type ModelV2 = { name:string; variants:Record<string,{disabled?:boolean}> }
wireModel = (base:string, v?:string) => v ? `${base}-${v}` : base // parseAutoModel validates
// Auth: Authorization: Bearer ${AGY_TOKEN}, Host ∈ {127.0.0.1:*, localhost:*}, baseURL ends /v1
```
Wrapper: `origFetch=globalThis.fetch; globalThis.fetch=(u,i)=>{ if(String(u).includes("127.0.0.1:7421/v1/chat/completions")&&body.variant) body.model=wireModel(body.model,body.variant); return origFetch(u,i)}` — try/catch, never throws into prompt pipeline.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Base extraction, `wireModel`, 14→28 fallback, variant subsets | `deno test` on helpers (mock TSV) |
| Integration | `GET /v1/models` Bearer, `Host` allow/403, `POST /v1/chat/completions` auto-rewrite accepted | `curl -H "Authorization: Bearer $AGY_TOKEN"` |
| E2E | `opencode models` lists only `auto-ro/rw-*`; `high` yields `choices[0].message.content` (stream+non-stream) | TUI: variant picker + chat |
| Rollback | Remove provider+auth, restart → no `agy-bridge/*` | `opencode models` |

## Threat Matrix

N/A — no routing/shell/subprocess/VCS boundaries. Loopback `baseURL` fixed, `accessGuard` enforces `Host`→403 and `Bearer`→401. No `--allow-*` expansion.

## Migration / Rollout

Apply: add provider+plugin to global `opencode.json`, `/connect Other → agy-bridge` paste token, restart, verify `curl`+`opencode models`. Rollback: remove provider + `auth.json` key + restart; no bridge/systemd change. No repo-local template.

## Open Questions

- [ ] Confirm opencode TUI surfaces `variants` for `auto-*` bases when `provider` hook supplies them (model-variants cache `~/.gentle-ai/cache/model-variants.json` refresh trigger on startup vs `opencode models --refresh`).
- [ ] Decide singleton display: expose `variants: {}` vs omit key (TUI shows single entry either way — verify).
