# Proposal: bridge-effort-reasoning-exposure

---
execution_mode: interactive
artifact_store.mode: openspec
delivery_strategy: ask-on-risk
review_budget_lines: 400
---

## Intent

SDD TUI blocks effort on `agy-bridge/auto-rw-gemini-3.7-flash` (`does not expose reasoning effort options`). `opencode-sdd-engram-manage` requires `capabilities.reasoning===true` + `variants.<k>.reasoningEffort`; bridge emits `variants:{high:{}}` with no capabilities → `unsupported` and effort cleared on sync.

## Scope

### In Scope
- Enrich `buildModelMap` + `install.sh` generator (`capabilities` + `reasoningEffort`)
- Update `plugins/agy-bridge.test.ts` + `opencode-provider` delta
- Migration via `./install.sh` re-run

### Out of Scope
- Second "dos problemas" — pending description
- Patch TUI cache; Deno permission change; dual ids

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `opencode-provider`: `Effort Variants` requires `capabilities.reasoning:true` when variants non-empty and `variants.<k>.reasoningEffort==k`; singleton `claude-sonnet-4-6` stays `variants:{}` without reasoning.

## Approach

**Approach 1 (RECOMMENDED):** Enrich `variantMap[v]={reasoningEffort:v}` + conditional `capabilities`; fixes picker/persistence/sync in ~20 lines, no runtime change. Approach 3 (forward `reasoningEffort` as `agy --effort` or suffix rewrite) deferred to design; suffix canonical.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `plugins/agy-bridge-helpers.ts` | Modified | Add `capabilities` + `reasoningEffort` |
| `plugins/agy-bridge.ts` | Modified | Re-copy deployed plugin |
| `install.sh:219-253` | Modified | Python fallback generator |
| `opencode.json` | Modified | Regenerated static models |
| `plugins/agy-bridge.test.ts` | Modified | Update assertions |
| `openspec/specs/opencode-provider/spec.md` | Modified | Spec delta |
| `agy-bridge.ts` | Deferred | Optional forwarding decision |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Stale `opencode.json` without capabilities | High | `./install.sh` re-run; verify `opencode models` |
| Singleton falsely advertised reasoning | Low | Guard `variants.size ? {reasoning:true} : undefined` |
| Variant vs `reasoningEffort` precedence | Med | Design defines SDD effort → variant sync |
| `--effort` version skew | Low | Keep suffix canonical |
| TUI cache patch | Low | Never patch TUI |

## Rollback Plan

Revert helpers + `install.sh`, re-run `./install.sh` to regenerate `opencode.json` + deployed plugin (or strip to `{}`), restart `opencode` → `unsupported` restored. Full rollback = remove `provider.agy-bridge` + `auth.json`. No systemd change unless forwarding added.

## Dependencies

- `opencode-sdd-engram-manage` `listReasoningEffortsFromModel` contract (read-only)
- `agy --effort` flag availability (optional, design phase)

## Success Criteria

- [ ] `auto-rw-gemini-3.7-flash` shows `high/medium/low` in TUI, no error
- [ ] Effort persists to `agent.*.reasoningEffort` and survives profile re-apply
- [ ] `opencode models` still 14 ids (7 bases ×2); `deno check` + tests pass

## Open Questions

1. Describe second problem or confirm out-of-scope?
2. Confirm `claude-sonnet-4-6` should stay `unsupported`?
3. Precedence when variant picker ≠ `reasoningEffort`?

## Proposal question round

Answer/skip or request second round: (1) second bridge problem details (2) singleton UX expectation (3) wire precedence rule.
