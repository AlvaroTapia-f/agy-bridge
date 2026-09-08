# Design: Repository Sanitation (sanitizar-repo)

## Technical Approach

Six ordered, revertible slices (proposal Approach 1): (1) lint/fmt scoping, (2) dead-code cleanup, (3) bundle consolidation gated by live smoke test, (4) installer Deno hardening + Python-generator removal, (5) 8/16 wording reconciliation, (6) service characterization. Each slice gates on `deno test` ≥56 and clean `deno check`; no service seam changes behavior.

Verified on Deno 2.9.5: `deno bundle` is deterministic (byte-identical), inlines helpers, erases the type-only stub import; JS-in-`.ts` output fails `deno check` (TS7006) unless a `// @ts-nocheck` banner is prepended (fix verified).

## Architecture Decisions

| Decision | Options (tradeoff) | Choice & rationale |
|---|---|---|
| Plugin artifact | shared-import (loader-unproven), `deno bundle` entrypoint, `deno compile` (wrong shape) | **Bundle.** New `plugins/agy-bridge.plugin.ts` imports model logic from helpers + plugin-only logic (fetch wrapper, variant state, hooks); bundle inlines helpers → self-contained, single source (S1/S3). |
| Generated-file integrity | bare `-o`, banner + atomic write | **Banner.** Prepend `// @ts-nocheck` + GENERATED header; tmp + `mv`. Banner REQUIRED or `deno test`/`check` fail. Deterministic + fixed banner ⇒ reproducible. |
| Parity contract | new import surface, re-export | **Re-export.** Entrypoint re-exports `groupBases`, `buildModelMap`, `FALLBACK_MODELS`; existing parity tests keep importing `./agy-bridge.ts`; add one drift test. |
| Smoke harness | backup/restore global, sandbox project | **Sandbox.** `tests/plugin-smoke.sh`: temp project + candidate bundle → `opencode models` → assert `agy-bridge/auto-*`. Never touches installed prior copy; validated on CURRENT plugin first. |
| Installer policy | retained minimal Python, hard Deno prerequisite | **Hard prerequisite.** `command -v deno` + `deno --version` before any sync (exit 1). Remove Python 4-pass generator (emits inert nested `capabilities`). Never-blocking stays inside `sync-models.ts` tiers; sync failure exits non-zero. Provider/auth/TUI python retained (config, not model sync). |
| Characterization | import module, black-box harness | **Black-box.** `agy-bridge.ts` runs `Deno.serve` + `refreshModels()` at import — unimportable. Harness spawns `deno run` with mock `agy`, random port, tmp `STATE_DIR`, `AGY_HARD_MARGIN_MS` override. |
| Lint scoping | top-level `exclude`, scoped sections | **Scoped.** `lint.exclude`/`fmt.exclude` match spec scenarios; archives stay in type-check scope. |

## Data Flow

```
helpers.ts → plugin entrypoint → deno bundle → plugins/agy-bridge.ts (generated)
     │                                 │            │
     ↓                           install.sh cp   plugin-smoke.sh
agy-bridge.ts, sync-models.ts    → ~/.config/…  (live gate)
     └── parity: bundle ≡ helpers (deno test) ←────┘
```

## File Changes

| File | Action | Description |
|---|---|---|
| `plugins/agy-bridge.plugin.ts` | Create | Bundle entrypoint; re-exports model fns |
| `plugins/agy-bridge.ts` | Modify | Generated bundle replaces hand copy (same path) |
| `plugins/agy-bridge.bundle.test.ts` | Create | Parity/drift tests vs helpers |
| `deno.json` | Modify | lint/fmt excludes; `bundle:plugin` task |
| `install.sh` | Modify | `deno --version` gate; remove Python generator + dead vars; sync-failure exit |
| `tests/install.test.sh` | Modify | §6 → missing-Deno fail-fast; drop "14 default models" |
| `tests/plugin-smoke.sh` | Create | Live-opencode smoke gate |
| `tests/service.test.ts` | Create | Characterization harness |
| `scripts/`,`plugins/` tests, `stubs/`, `agy-bridge.ts` | Modify | Unused imports, `async`, RED labels, lint typing, stale comments |
| `README.md` | Modify | L43 Python wording → Deno prerequisite; bundle workflow |

## Interfaces / Contracts

```ts
// plugins/agy-bridge.plugin.ts — export contract (preserved in bundle)
export { groupBases, buildModelMap, FALLBACK_MODELS } from "./agy-bridge-helpers.ts";
export default AgyBridgePlugin: Plugin;
```

Generated file: line 1 `// @ts-nocheck`, line 2 GENERATED marker; regenerate via `deno task bundle:plugin`. Installer: `deno --version` missing/failing ⇒ exit 1 with prerequisite message before any sync, no Python fallback.

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | Parity bundle≡helpers (FALLBACK + drift); model shape; lint/fmt zero | `deno test` |
| Integration | Installer fail-fast, idempotency, sync; smoke gate | shell tests (mock HOME); smoke script (live) |
| E2E | 403 host/401 auth/healthz, 400 routing, SSE + `[DONE]` + keepalive, deadline kill, salvage, retry | Black-box harness, mock `agy`, TDD RED first |

## Threat Matrix

| Boundary | Applicability | Design response / RED tests |
|---|---|---|
| Documentation-like paths | N/A — .md content only | — |
| Git repo selection | N/A — no git automation | — |
| Commit state | N/A — no commit automation | — |
| Push state | N/A — no push automation | — |
| PR commands | N/A — no PR automation | — |
| Installer shell | Applicable | Missing Deno → exit 1 pre-sync; RED: PATH without deno |
| Harness subprocess | Applicable | Hermetic tmp paths; child scoped `--allow-*`; kill on abort |
| Smoke subprocess | Applicable | Read-only `opencode models`; sandbox; no global mutation |

## Migration / Rollout

No data migration. One chained PR per slice; order: scoping → cleanup → smoke green (current plugin) → bundle swap (after candidate smoke green) → installer hardening → reconciliation (main-spec merge via sdd-archive) → characterization. Slices revert independently; plugin rollback = prior commit + re-run smoke.

## Open Questions

- [ ] Confirm `opencode models` lists plugin models from a project-level `.opencode/plugins/` sandbox (calibrate on current plugin first).
- [ ] Sync-run failure semantics (exit 1 vs warn) — spec mandates only missing-Deno fail-fast; confirm exit-1.
