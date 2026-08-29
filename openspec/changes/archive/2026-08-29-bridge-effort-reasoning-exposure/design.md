# Design: bridge-effort-reasoning-exposure

---
execution_mode: interactive
artifact_store.mode: openspec
delivery_strategy: ask-on-risk
review_budget_lines: 400
---

## Technical Approach

Conform `agy-bridge` model metadata to `opencode-sdd-engram-manage` `listReasoningEffortsFromModel` contract: emit `{ reasoningEffort: k }` per variant and conditional `capabilities.reasoning`. Fixes TUI `unsupported` → `selectable` and profile persistence with no runtime change. Suffix via `wireModel`+fetch wrapper remains canonical wire; ~20 lines in helpers + `install.sh` fallback.

## Architecture Decisions

| Decision | Option | Tradeoff | Choice |
|---|---|---|---|
| **A1 Variant payload** | (a) `variants.{k}={}` | Fails `v.reasoningEffort.trim()` → unsupported | Reject |
| | (b) `variants.{k}={reasoningEffort:k}` | Satisfies SDK/TUI gate 1:1 | **Choose (b)** |
| **A2 Capabilities** | (a) Always `{reasoning:true}` | Singleton shows empty picker | Reject |
| | (b) `variants.size ? {reasoning:true} : undefined` | Singleton `unsupported` correct | **Choose (b)** (`Set.size` / `len(vars)`) |
| **A3 Precedence** | (a) Suffix canonical, defer effort forwarding | No extra code path | **Choose (a)** |
| | (b) Map `reasoningEffort` → `--effort`/suffix | Version-skew, conflicts with suffix | Defer (see below) |
| **A4 Migration** | (a) Docs only | Stale JSON stays broken | Reject |
| | (b) Idempotent `install.sh` re-run + staleness check | Auto-heals len==14 but stale | **Choose (b)** |
| **A5 Permissions** | New `--allow-*` | No new I/O | **None** (`--allow-net=127.0.0.1 --allow-run --allow-env` unchanged) |

**Precedence (canonical: SDD `reasoningEffort` → variant suffix):** After A1+A2, TUI persists `agent.<name>.reasoningEffort` only when `selectable`; fetch wrapper derives wire suffix from `variantByModel` (`chat.message` hook → `wireModel`). Link is deterministic: SDD value `k` → variant key `k` → wire `auto-*--<k>`. On transient divergence (e.g., picker `high` vs stored `low`), wire suffix wins that request; next `applyProfileReasoningEffort` re-validates against `listReasoningEffortsFromModel` and re-aligns. No `agy-bridge.ts` change.

**Deferred forwarding:** `agy --effort` / bare-model `reasoningEffort → suffix` rewrite is **DEFERRED**. Suffix is canonical in `agy models` / `parseAutoModel`; `--effort` varies by `agy` version and is ignored for suffixed models. Keep bridge unchanged per proposal Approach 1; a minimal `handleChat` shim (`body.reasoningEffort||reasoning_effort||effort` → validated suffix rewrite) is reserved for a follow-up.

## Data Flow

```
TUI/profile ──reasoningEffort──→ opencode.json ──applyProfileReasoningEffort──→ agent.*
     │  listReasoningEffortsFromModel reads
     ▼
provider hook buildModelMap(groupBases(slugs)) → {capabilities, variants.{k:{reasoningEffort:k}}}
     │  (FALLBACK/install.sh static on cold start)
     ▼
fetch wrapper variantByModel → wireModel(base,variant) → POST /v1/chat/completions model:"auto-rw-…-high"
     └→ agy-bridge parseAutoModel → runAgy(agy --model real) [unchanged]
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `plugins/agy-bridge-helpers.ts` | Modify | `variantMap[v]={reasoningEffort:v}`; `capabilities: variants.size?{reasoning:true}:undefined`; typed `Record<string,{reasoningEffort:string}>`. |
| `plugins/agy-bridge.ts` | Modify | Mirror helpers (self-contained copy); `resolveSlugs`/`installFetchWrapper` unchanged. |
| `install.sh:219-253` | Modify | Python: `vmap={v:{"reasoningEffort":v} for v in sorted(vars)}`; `models[id_]={..., **({"capabilities":{"reasoning":True}} if vars else {})}`; regenerate if any entry lacks `capabilities.reasoning` or `variants.*.reasoningEffort`. |
| `plugins/agy-bridge.test.ts` | Modify | Assert `reasoningEffort==key`, `capabilities.reasoning===true` iff non-singleton, singleton no capabilities, `thinking` case. |
| `opencode.json` | Regenerated | Via `./install.sh` idempotent upsert (no repo file). |
| `agy-bridge.ts` | No change | Effort forwarding deferred. |

## Interfaces / Contracts

```ts
// before: variantMap: Record<string,{disabled?:boolean}> = {}; variantMap[v]={}
// after:
type VariantSpec = { reasoningEffort: string }
type ModelSpec = { id:string; name:string; provider:{id:"agy-bridge"}; capabilities?:{reasoning:true}; variants:Record<string,VariantSpec> }
// buildModelMap: for (v of variants) variantMap[v]={reasoningEffort:v}
// out[id]={ id,name,provider, ...(variants.size?{capabilities:{reasoning:true}}:{}), variants:variantMap }
```
Python parity identical; `EFFORT_SUFFIXES` remains source of truth.

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | `buildModelMap` shape + singleton guard | `deno test` asserts `variants.*.reasoningEffort==key`, capabilities conditional, `thinking` |
| Static | Types | `deno check plugins/agy-bridge-helpers.ts && deno check plugins/agy-bridge.ts` |
| Integration | `install.sh` idempotency | Run twice; inject stale `{"high":{}}` then re-run → enriched |
| E2E | TUI+wire | `opencode models` (14 ids), `jq '.provider["agy-bridge"].models["auto-rw-gemini-3.7-flash"]'` shows capabilities+reasoningEffort, picker `selectable` (gemini) vs `unsupported` (sonnet-4-6) |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR, executable-classification, or process-integration boundary. Only JSON metadata enrichment; `accessGuard`/`runAgy`/`--allow-*` unchanged.

## Migration / Rollout

1. Merge helpers+plugin+`install.sh`.
2. Re-run `./install.sh` — staleness guard regenerates even if `len==14`.
3. Verify: `opencode models | grep agy-bridge` (14); `jq` shows `capabilities.reasoning` and `variants.*.reasoningEffort`; TUI no longer `does not expose…`; profile re-apply retains effort.
4. No flag/phased rollout.

## Rollback Sketch

Revert three files, re-run `./install.sh` (or strip `capabilities`/`reasoningEffort`), restart opencode → `unsupported` restored. Full: remove `provider.agy-bridge`/`auth.json`/`plugins/agy-bridge.ts`. No systemd change.

## Open Questions

- [ ] None blocking. Follow-up: optional bare `reasoningEffort→suffix` shim.
