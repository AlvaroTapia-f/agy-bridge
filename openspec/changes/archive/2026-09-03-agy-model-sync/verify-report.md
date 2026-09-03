# Verification Report — agy-model-sync

**Change:** agy-model-sync
**Mode:** Strict TDD
**Verdict:** PASS
**Date:** 2026-09-03

## Build & Tests (real execution)

- `deno check agy-bridge.ts scripts/sync-models.ts` → EXIT 0
- `deno test` → 34 passed, 0 failed (17 plugins/agy-bridge.test.ts + 17 scripts/sync-models.test.ts)
- `bash -n install.sh` → OK
- `bash tests/install.test.sh` → 15 passed, 0 failed (6 sections: static, missing, deno sync, idempotency, dynamic, fallback)
- `deno task sync:models --dry-run` → EXIT 0, JSON with 14 enriched models (reasoning capabilities/variants), e.g. auto-ro-gemini-3.8-flash {high,medium,low}

## Spec Compliance — 16/16 scenarios

| Requirement | Scenario | Result |
|-------------|----------|--------|
| model-sync REQ-1 | Successful TSV resolution | ✅ |
| model-sync REQ-2 | Efforts inferred from live TSV | ✅ |
| model-sync REQ-2 | New effort appears dynamically (ultra) | ✅ |
| model-sync REQ-2 | Compatibility with FALLBACK (7 bases) | ✅ |
| model-sync REQ-2 | Bridge API Fallback (GET /v1/models) | ✅ |
| model-sync REQ-2 | Offline Fallback — never-blocking | ✅ |
| model-sync REQ-3 | Preserving existing configuration | ✅ |
| model-sync REQ-3 | Dry-run mode | ✅ |
| install REQ-1 | Fresh-machine restore | ✅ |
| install REQ-1 | Install provisions provider (Deno-first) | ✅ |
| install REQ-1 | Idempotent provisioning | ✅ |
| provider REQ-1 | Provider visible | ✅ |
| provider REQ-1 | No bare ids | ✅ |
| provider REQ-2 | buildModelMap enriched shape | ✅ |
| provider REQ-2 | sync script identical shape | ✅ |
| provider REQ-3 | Stale JSON migration | ✅ |

## TDD Compliance — 6/6

- RED confirmed, GREEN passed, triangulation (malformed/normal/timeout), safety net for helpers, no modified files without tests.

## Files Verified

- `scripts/sync-models.ts` — parseTsv, resolveSlugs 3-tier, atomic RMW (.bak + tmp+rename), CLI --dry-run/--config-path/--agy-bin/--bridge-url
- `plugins/agy-bridge-helpers.ts` — 4-pass groupBases dynamic effort inference
- `deno.json` — task sync:models with scoped --allow-*
- `install.sh` — Deno-first + python3 fallback, never blocks, bash -n clean
- `tests/install.test.sh` — 15 integration tests
- `README.md` — sync:models docs

## Risks

None — all critical paths covered, never-blocking fallback verified.
