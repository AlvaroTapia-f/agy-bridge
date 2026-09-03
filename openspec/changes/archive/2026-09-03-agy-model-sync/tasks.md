# Tasks: AGY Model Sync

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 430–550 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1: helpers+script+task → PR2: install.sh+tests+docs |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Script + dynamic effort + task | PR 1 | `deno test scripts/sync-models.test.ts` | `deno task sync:models --dry-run; jq .provider["agy-bridge"] ~/.config/opencode/opencode.json` | Revert `scripts/*`, `deno.json`, `plugins/agy-bridge-helpers.ts` |
| 2 | Installer + verification | PR 2 | `bash -n install.sh && deno check scripts/sync-models.ts && deno test` | `./install.sh && opencode models \| grep agy-bridge && curl http://127.0.0.1:7421/v1/models` | Revert `install.sh` to Python gen; script unused |

## Phase 1: Foundation

- [x] 1.1 Extend `plugins/agy-bridge-helpers.ts` `stripEffortSuffix` to infer unknown suffixes dynamically; verify `groupBases(FALLBACK_MODELS)` yields 7 bases
- [x] 1.2 Add `deno.json` task `sync:models` with `--allow-run=agy --allow-net=127.0.0.1:7421 --allow-read --allow-write --allow-env`
- [x] 1.3 Scaffold `scripts/sync-models.ts` — imports from helpers, `parseTsv`/`resolveSlugs`/`syncModels` signatures, CLI `--dry-run`/`--config-path`

## Phase 2: Core Implementation

- [x] 2.1 Implement `parseTsv` in `scripts/sync-models.ts` — split `\n`, col0 before `\t`, trim, filter empty, tolerant to malformed rows
- [x] 2.2 Implement `resolveSlugs` — spawn `agy models` (timeout 10s) → `GET /v1/models` → `FALLBACK_MODELS`; return `{slugs, source}`
- [x] 2.3 Implement dynamic effort — `groupBases(slugs)` → `buildModelMap` → `auto-ro/rw-*` with `capabilities.reasoning` iff variants non-empty; `ultra` captured
- [x] 2.4 Implement atomic RMW — read `opencode.json`, `.bak` backup, update only `provider["agy-bridge"].models`, `tmp`+`rename`, preserve others
- [x] 2.5 Implement CLI — `--dry-run` prints JSON no write; log count/source; never log token; fallback never blocks

## Phase 3: Integration

- [x] 3.1 Modify `install.sh` L189–303 — replace Python gen with `"$DENO_BIN" run scripts/sync-models.ts`; keep `python3` fallback when Deno missing; never fail install
- [x] 3.2 Verify `install.sh` handles missing `opencode.json`; `bash -n install.sh` passes

## Phase 4: Testing (strict TDD)

- [x] 4.1 RED: `scripts/sync-models.test.ts` — `parseTsv` valid/empty/missing-tab/blank-line cases
- [x] 4.2 RED: dynamic effort — `gemini-3.8-flash-ultra` → `variants.ultra.reasoningEffort==="ultra"`; FALLBACK 7-base equivalence
- [x] 4.3 RED: fallback chain — mock spawn fail → api success; both fail → fallback; assert `source`
- [x] 4.4 RED: subprocess threat — invalid `AGY_BIN`/timeout/malformed TSV injection → falls to next tier, no blocking error, no token leak
- [x] 4.5 RED: atomic write — temp dir, `tmp+rename`, `.bak` created, other providers preserved
- [x] 4.6 RED: dry-run — flag outputs JSON stdout, zero file mutations
- [x] 4.7 GREEN: make 4.1–4.6 pass in `scripts/sync-models.ts`; `deno test` green

## Phase 5: Verification & Docs

- [x] 5.1 Run `deno check scripts/sync-models.ts && deno test && bash -n install.sh`
- [x] 5.2 E2E `deno task sync:models && opencode models | grep agy-bridge && jq '.provider["agy-bridge"].models'`
- [x] 5.3 Update `README.md` with `sync:models` usage; verify no bare `gemini-*` ids

