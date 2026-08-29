# Archive Report: custom-opencode-provider-agy-bridge

- **Change**: custom-opencode-provider-agy-bridge
- **Archived**: 2026-08-29
- **Mode**: openspec (interactive)
- **Verdict**: PASS_WITH_WARNINGS → PASS (post-verify bugfix validated)
- **Task Completion**: 12/12 tasks complete (0 unchecked)
- **Tests**: 12/12 pass, `deno check` 0 errors
- **Review Gate**: absent (ordinary repository policy — no native review receipt required)
- **Execution Mode at Archive**: interactive (workspace-planning guard not triggered; allowedEditRoots respected)

## Summary

Global `agy-bridge` provider for `opencode` is now first-class: `provider.agy-bridge` in `~/.config/opencode/opencode.json` (`npm: "@ai-sdk/openai-compatible"`, `baseURL: "http://127.0.0.1:7421/v1"`), per-request `Bearer AGY_TOKEN` via `auth.json` (`type: api`, `600`) created through `/connect Other → agy-bridge`, `plugins/agy-bridge.ts` dynamically building `provider.agy-bridge.models` (`auto-ro/*` + `auto-rw/*` with `variants` per effort suffix), `fetch` wrapper + `chat.message` hook rewriting variants to suffixed wire ids validated by `modelSlugs`/`parseAutoModel`, loopback `Host` guard preserved, `install.sh` + `README` provisioning and verification documented, rollback idempotent, strict TDD 12/12, bridge non-bannable logic unchanged (still spawns `agy` binary).

## Final-State Authority

This report is the terminal record (rank 1: structured status + final-state facts from orchestrator; rank 2: persisted `tasks.md` 12/12; rank 3: explicit post-verify bugfix facts; rank 4: intermediate `verify-report`/`apply-progress` snapshots). Where earlier snapshots said pending/blocked, this report reflects what actually shipped at close.

- **Sources ranked**: `tasks.md` 12/12 checked, final-state facts (post-verify variant fix), `verify-report` PASS_WITH_WARNINGS (13/14 compliant, 1 partial), `apply-progress` (12/12 with deviations table).
- **Stale claims superseded**: `verify-report` flagged Fallback 28 vs 14 as PARTIAL — final-state facts and design confirm 14 grouped (7 bases × 2) is correct; spec text was stale, not impl. Recorded below as accepted deviation, not a current defect.
- **Post-verify work folded in**: Variant-via-`chat.message` hook + `fetch` wrapper using `variantByModel` map + default variant fallback (`medium`/`high`) was fixed AFTER `verify-report` and validated live (`auto-ro-gemini-3.7-flash + high` → `auto-ro-gemini-3.7-flash-high`). Debug logs removed, `deno check`/`test` still 0/12 pass, plugin clean at both `plugins/agy-bridge.ts` and `~/.config/opencode/plugins/agy-bridge.ts` self-contained.

No `reviewGate` present — archive proceeds under ordinary policy (kill switch off or post-verify invitation declined; both are non-blocking per Native Review Receipt Gate).

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| opencode-provider | **Created** | `openspec/specs/opencode-provider/spec.md` — 9 requirements, 15 scenarios: Global Provider Registration, Auto-Prefixed Model Enumeration (corrected Fallback 14 grouped), Effort Variants, Variant-to-Suffix Wire Contract (with default fallback), Per-Request Bearer Auth, BaseURL and Host Correctness, E2E Verification, Rollback, Bridge Non-Bannable Guarantee. Deviation note for 28→14 accepted. |
| install-automation | **Updated** | Appended `Install Automation — Global Provider Docs` (extends existing): provider provisioning, 14 models with variants, plugin copy, `curl`/`opencode models` verification, idempotent, `bash -n` clean. Preserves prior 2 requirements (Installation Script Workflow, Manual Installation Fallback). |
| secret-management | **Updated** | Appended `Secret Management — Opencode Token Flow` (extends existing): `auth.json` `type:api` `600` via `/connect Other`, `"{env:AGY_TOKEN}"` alt, `auth.loader` → `{apiKey}`, `accessGuard` `401`/`403`, no literal in repo. Preserves prior 3 requirements (Token Externalization, Secret Documentation, Token Leak Prevention). |
| repo-hygiene | Unchanged | No changes for this change. |

**Spec sync method**: New domain file created via `Write`; existing specs updated via `Edit` preserving unrelated requirements. No `diff -r` byte-copy required for specs (merged, not verbatim copied). Archive folder move verified via `diff -r` empty (see below).

### Known Deviation — Documented as Accepted

`spec.md` (delta) Fallback scenario stated `28 ids (14 × 2 profiles)` as flat suffixed ids. Implementation correctly groups 14 suffixed `FALLBACK_MODELS` into 7 distinct bases (`gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.1-pro`, `claude-sonnet-4-6`, `claude-opus-4-6`, `gpt-oss-120b`) → 14 ids (`7 × 2: auto-ro/* + auto-rw/*`) with `variants` maps. Flat 28 would duplicate variant ids and violate the `variants` requirement (one base, subset picker). Design `groupBases` stripping `{-high,-medium,-low,-thinking}` + `apply-progress` deviations table + `verify-report` WARNING document this as intentional variant-aware grouping. Updated main spec `opencode-provider` now states `14 grouped ids` with deviation note; change delta preserved in archive for audit.

## Archive Contents

- proposal.md ✅ (intent: static provider + `/connect Other` flat, later evolved to variants plugin)
- spec.md ✅ (8 ADDED + 2 MODIFIED; Fallback wording now documented as 14 grouped in main spec)
- design.md ✅ (plugin fetch-wrapper + provider hook, 400-line budget, no `agy-bridge.ts` perm changes)
- tasks.md ✅ (12/12 complete — Phase 1: 1.1, 1.2 RED, 1.3; Phase 2: 2.1, 2.2, 2.3, 2.4; Phase 3: 3.1, 3.2; Phase 4: 4.1, 4.2, 4.3)
- apply-progress ✅ (TDD evidence, deviations: fallback 14 grouping, plugin helper isolation)
- verify-report.md ✅ (PASS_WITH_WARNINGS 13/14, 1 partial fallback wording; 12 tests, `deno check` 0)
- exploration.md ✅
- archive-report.md ✅ (this file — additive, excluded from `diff -r`)

## Source of Truth Updated

- `openspec/specs/opencode-provider/spec.md` (new)
- `openspec/specs/install-automation/spec.md` (updated)
- `openspec/specs/secret-management/spec.md` (updated)

## Task Completion Gate

- **Persisted `tasks.md`**: All 12 tasks checked (`- [x]`) at close — gate passes. No stale unchecked implementation tasks remain; exceptional reconciliation not needed (`apply-progress`/`verify-report` both confirm 12/12). Archived `tasks.md` verified after move — 12 checked, 0 unchecked.

## Final Verification (per Final-State Facts + Live Checks at Archive)

| Check | Spec Scenario | Evidence (at archive time 2026-08-29) | Result |
|-------|---------------|----------------------------------------|--------|
| **Provider visible** | Provider visible | `opencode models` lists 14 `agy-bridge/auto-ro-*` + `auto-rw-*` (7 bases × 2); no bare `gemini-*`/`claude-*` | ✅ PASS |
| **No bare ids** | No bare ids | `opencode models \| grep -v auto-` → 0 bare; `opencode.json models` keys all `auto-ro/rw-*`; `buildModelMap` asserts no bare | ✅ PASS |
| **Live enumeration** | Live enumeration | `curl -H "Authorization: Bearer $AGY_TOKEN" :7421/v1/models` → `200` + 14 ids; provider hook `resolveSlugs` → `GET /v1/models` with Bearer, parsed `modelSlugs` TSV | ✅ PASS |
| **Fallback** | Fallback (grouped) | `provider hook fallback` test returns 14 grouped ids when bridge unreachable; `FALLBACK_MODELS` 14 → 7 bases → 14 `auto-ro/rw-*` (spec deviation documented as correct) | ✅ PASS (spec corrected to 14) |
| **Variants picker** | Picker | `auto-ro-gemini-3.7-flash` variants `high,medium,low`; `gemini-3.1-pro` → `{high,low}`; `claude-sonnet-4-6` → `{}`; plugin `groupBases` `Map<base,Set<variant>>` verified 7 bases | ✅ PASS |
| **Wire contract** | Suffixed wire id | `wireModel(high)` → `auto-ro-gemini-3.7-flash-high`; post-verify fix: `chat.message` hook stores `variantByModel` + `fetch` wrapper rewrites `body.model` via `wireModel` using `variantByModel` + default fallback (`medium`/`high`); live validated `auto-ro-gemini-3.7-flash + high` rewrites to `auto-ro-gemini-3.7-flash-high`, tested multiple models, debug logs removed, `deno check/test` 0/12 | ✅ PASS |
| **Default variant fallback** | Variant-to-Suffix (default) | Bare `auto-ro-gemini-3.7-flash` (no suffix) → rewritten to `auto-ro-gemini-3.7-flash-medium` (default) via `defaultVariantForBase`; `parseAutoModel` validates | ✅ PASS |
| **Auth succeeds** | Auth succeeds | `curl -H "Bearer $AGY_TOKEN" :7421/v1/models` → `200`; `curl POST /v1/chat/completions` with auth → `200 pong`; `auth.json` entry `agy-bridge:{type:api,key}` `600`; plugin `auth.loader` returns `apiKey` | ✅ PASS |
| **Missing auth** | Missing auth | `curl` no header → `401 unauthorized`; `accessGuard` Bearer check | ✅ PASS |
| **Correct routing** | Correct routing | `opencode.json` `baseURL http://127.0.0.1:7421/v1` ends `/v1`; `POST /v1/chat/completions` → `200` not `404`; wrapper matches `7421/v1/chat/completions` + `localhost` | ✅ PASS |
| **Spoofed host** | Spoofed host | `curl -H "Host: evil.com" -H "Bearer $AGY_TOKEN" /v1/models` → `403 forbidden host`; `accessGuard` Host check | ✅ PASS |
| **E2E happy** | Happy verification | `curl /v1/models` 200 + `opencode models` 14 + `curl POST` non-stream `choices[0].message.content="pong"` + stream SSE `pong` + `[DONE]` verified | ✅ PASS |
| **Rollback** | Clean rollback | Remove `provider.agy-bridge` + delete `auth.json:agy-bridge` + delete plugin + restart opencode → `opencode models \| grep -c agy-bridge` 0 (restore → 14); `install.sh` rollback boundary documented | ✅ PASS |
| **No secret in repo** | No secret in repo | `grep -r AGY_TOKEN` repo only placeholder `"{env:AGY_TOKEN}"` + docs; literal token `grep` → 0; `auth.json` 600, `env` 600 | ✅ PASS |
| **Bridge non-bannable** | Bridge delegation | Bridge still spawns `agy` binary per request, loopback `Host` guard, Bearer `AGY_TOKEN`, no Google direct, no `--allow-*` expansion | ✅ PASS |

**Build & tests at archive**: `deno check agy-bridge.ts` → 0 errors; `deno check plugins/agy-bridge.ts` → 0 errors (via `deno.json` stubs); `deno test` → 12 passed / 0 failed (92ms) — unchanged after post-verify fix.

**Post-verify bugfix (final-state record)**: `verify-report` passed but variant path used body `variant` which opencode never sends. Fix added `chat.message` hook (`variantByModel`/`variantBySession`) + enhanced `fetch` wrapper that prefers body `variant` else stored map else `defaultVariantForBase` (`medium` → `high` → `low` → `thinking`). Now `auto-ro-gemini-3.7-flash + high` correctly rewrites to `auto-ro-gemini-3.7-flash-high`. Tested with multiple models (`gemini-3.7-flash`, `gemini-3.1-pro`, etc.). Self-contained logic in `plugins/agy-bridge.ts` and `~/.config/opencode/plugins/agy-bridge.ts`, no debug logs. Validated live at archive time (see table above; `deno check/test` still 0/12).

## Mechanical Copy Verification

- **Spec sync**: New/updated spec files created via `Write`/`Edit` (merged, not verbatim copy) — no `diff -r` byte-copy applicable; content preserved per requirements above.
- **Archive move** (`openspec/changes/custom-opencode-provider-agy-bridge` → `openspec/changes/archive/2026-08-29-custom-opencode-provider-agy-bridge`):

```text
(snapshot via cp -R to $snapshot_root/source, then mv)
diff -r "$snapshot_root/source" "openspec/changes/archive/2026-08-29-custom-opencode-provider-agy-bridge"
# (empty — no differences) ✅
```

- Source directory confirmed absent after move (`[ -e src ]` false).
- `archive-report.md` is additive-only and excluded from source/destination `diff -r` (did not exist in snapshot).
- Verbatim `diff -r` empty is the only passing evidence; self-report insufficient. Skipped `diff -r` would FAIL the phase — not skipped.

## Operational Status at Archive

- Bridge: `curl http://127.0.0.1:7421/v1/models` with `Bearer $AGY_TOKEN` → `200`; without → `401`; `Host: evil.com` → `403`; `POST /v1/chat/completions` stream+non-stream → `choices[0].message.content` ✅
- `opencode models` → 14 `agy-bridge/auto-*` with correct `variants` ✅
- `auth.json` `600`, `env` `600`, plugin `8722` bytes self-contained ✅
- `install.sh` idempotent (`bash -n` OK, python generates 14 models + variants, copies plugin, echoes verify) ✅
- `README` documents provider, auth `600`, `baseURL /v1` + Host, verify, rollback ✅
- Deno: `deno check` 0, `deno test` 12/12 ✅

## Risks / Follow-ups

- **Low**: Spec 28→14 deviation now documented in main spec, but historic delta `spec.md` in archive still says 28 — readers must consult `openspec/specs/opencode-provider/spec.md` for canonical 14 grouped + deviation note.
- **Low**: Plugin helper isolation (`gy-bridge-helpers.ts` for tests) required due to Bun loader `Plugin export is not a function` when named exports added to plugin file; future helper additions must keep runtime plugin self-contained.
- **Low**: `deno lint` reports `catch {}` empty + `async` without `await` (intentional try/catch never throws into pipeline; `Plugin async` required by type) — fix with `catch { /* ignore */ }` + `deno-lint-ignore` if lint gate tightened.
- **Low**: `deno fmt --check` diffs (semicolons) — not blocking unless fmt enforced in CI; can run `deno fmt` before next change.
- **None**: No CRITICAL verification issues; archive not blocked. All 12 tasks done, no unchecked tasks, no destructive spec delta.

## SDD Cycle Complete

The change has been fully planned (proposal → spec → design → tasks), implemented with strict TDD (12/12), verified (PASS_WITH_WARNINGS, post-verify variant fix validated), spec-synced (new `opencode-provider` + updated `install-automation`/`secret-management`), and archived.

Ready for the next change.

---
*Teams: sdd-archive (engram/openspec), 2026-08-29, `custom-opencode-provider-agy-bridge`*

## Change Archived

**Change**: custom-opencode-provider-agy-bridge
**Archived to**: `openspec/changes/archive/2026-08-29-custom-opencode-provider-agy-bridge/` (openspec)

### Specs Synced
| Domain | Action | Details |
|--------|--------|---------|
| opencode-provider | Created | 9 requirements, 15 scenarios (Global Provider, Auto-Prefixed 14 grouped, Variants, Wire Contract+default, Auth, Host, E2E, Rollback, Non-Bannable) |
| install-automation | Updated | +1 requirement (Global Provider Docs) — 3 requirements total |
| secret-management | Updated | +1 requirement (Opencode Token Flow) — 4 requirements total |

### Archive Contents
- proposal.md ✅
- spec.md ✅ (with accepted 28→14 deviation note in main spec)
- design.md ✅
- tasks.md ✅ (12/12 tasks complete)
- verify-report.md ✅ (PASS_WITH_WARNINGS 13/14, post-verify fix validated)
- apply-progress ✅
- exploration.md ✅
- archive-report.md ✅ (this file)

### Source of Truth Updated
- `openspec/specs/opencode-provider/spec.md` (new)
- `openspec/specs/install-automation/spec.md`
- `openspec/specs/secret-management/spec.md`

### SDD Cycle Complete
The change has been fully planned, implemented, verified, and archived.
Ready for the next change.
