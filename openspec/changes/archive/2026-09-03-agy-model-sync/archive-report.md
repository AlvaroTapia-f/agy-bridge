# Archive Report: agy-model-sync

**Date**: 2026-09-03
**Change**: agy-model-sync
**Verdict**: PASS — SDD cycle complete
**Artifact Store**: hybrid (Engram + OpenSpec)

## Executive Summary

Sync script `scripts/sync-models.ts` maps live `agy models` to `opencode.json` with 3-tier fallback (TSV → API → FALLBACK), dynamic effort capture (including `ultra`), and atomic RMW. Installer delegates to sync script with Python fallback. 20/20 tasks complete, 67 tests passing, 16/16 spec scenarios verified.

## Final State (per Final-State Authority)

| Fact | Value | Source |
|------|-------|--------|
| Tasks | 20/20 complete | tasks.md (persisted artifact) |
| Verify verdict | PASS 16/16 | verify-report.md (intermediate snapshot, confirmed by launch prompt) |
| Deno tests | 34 passed, 0 failed | verify-report.md + launch prompt final-state facts |
| Install tests | 15 passed, 0 failed | verify-report.md + launch prompt final-state facts |
| Install-remote tests | 18 passed, 0 failed | apply-progress.md work unit evidence |
| Build | deno check EXIT 0, bash -n OK | verify-report.md |
| Dry-run | 14 enriched models | verify-report.md |
| CRITICAL issues | None | verify-report.md |
| Warnings fixed later | None needed | launch prompt: "none — verify PASS with real shell execution" |

## Files Changed (Implementation)

| File | Action |
|------|--------|
| `scripts/sync-models.ts` | Created — standalone sync script |
| `scripts/sync-models.test.ts` | Created — 34 unit tests |
| `plugins/agy-bridge-helpers.ts` | Modified — 4-pass dynamic effort inference |
| `deno.json` | Modified — `sync:models` task |
| `install.sh` | Modified — Deno-first + python fallback |
| `tests/install.test.sh` | Created — 15 integration tests |
| `README.md` | Modified — sync:models docs |

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| model-sync | Created (full spec) | 3 requirements, 6 scenarios — copied from delta as new domain |
| opencode-provider | Updated | 3 requirements modified: Global Provider Registration, Reasoning Model Shape Conformance, Stale Model Migration |
| install-automation | Updated | 1 requirement modified: Install Automation — Global Provider Docs |

## Archive Contents

- `proposal.md` ✅
- `specs/model-sync/spec.md` ✅
- `specs/opencode-provider/spec.md` ✅
- `specs/install-automation/spec.md` ✅
- `design.md` ✅
- `tasks.md` ✅ (20/20 tasks complete)
- `apply-progress.md` ✅
- `verify-report.md` ✅

## Source of Truth Updated

- `openspec/specs/model-sync/spec.md` — NEW (full spec from delta)
- `openspec/specs/opencode-provider/spec.md` — UPDATED with sync-script-driven registration
- `openspec/specs/install-automation/spec.md` — UPDATED with sync-script delegation

## Native Review Receipt Gate

`reviewGate` structurally absent. No review was ever started for this candidate. Receipt-driven development not applicable.

## Engram Observation IDs Read

| Artifact | Observation ID |
|----------|---------------|
| proposal | #6 |
| design | #8 (superseded by #7 — dynamic effort clarification) |
| design update | #7 |
| tasks | #9 |
| verify-report | #10 |

## Key Learnings

1. Stacked-to-main delivery with PR1 (helpers+script ~280 lines) + PR2 (install+docs ~150 lines) kept both slices within review budget despite High initial forecast.
2. Dynamic effort capture requires keeping EFFORT_SUFFIXES in helpers for fallback compatibility while live inference handles unknown suffixes like `ultra`.
3. Mechanical shell copy with diff -r readback is the only reliable way to verify archive byte-identity — model Read/Write routing silently truncates.
