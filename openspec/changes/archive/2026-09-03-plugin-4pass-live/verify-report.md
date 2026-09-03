# Verification Report — plugin-4pass-live

**Change:** plugin-4pass-live
**Mode:** Strict TDD
**Verdict:** PASS
**Date:** 2026-09-03

## Build & Tests (real execution)

- `deno check agy-bridge.ts plugins/agy-bridge.ts plugins/agy-bridge-helpers.ts scripts/sync-models.ts` → EXIT 0
- `deno test plugins/agy-bridge.test.ts scripts/sync-models.test.ts` → 36 passed, 0 failed
- `bash -n install.sh` → OK
- `deno task sync:models --dry-run` (live) → 14 ids (7 bases, includes gemini-3.8-flash)
- `AGY_BIN=/nonexistent deno task sync:models --dry-run` (fallback) → 16 ids (8 bases: gemini-3.8-flash, 3.7, 3.6, 3.5, 3.1-pro, claude-sonnet, claude-opus, gpt-oss)
- `AGY_BIN=/nonexistent deno task sync:models --dry-run | jq keys` → 16 sorted: auto-ro/rw-gemini-3.8-flash, 3.7, 3.6, 3.5, 3.1-pro, claude-opus, claude-sonnet, gpt-oss

## Spec Compliance — 13/13

All opencode-provider, model-sync, install-automation scenarios PASS. Fallback 17/8/16 parity verified across Deno helpers, plugin self-contained, and Python fallback. Parity plugin==helpers confirmed.

## TDD Compliance — 6/6

RED->GREEN with triangulation, safety net, 17/8/16 exact asserts.

## Files Verified

- plugins/agy-bridge.ts — 4-pass self-contained + FALLBACK 17 + LOCKSTEP
- plugins/agy-bridge-helpers.ts — FALLBACK 17 + LOCKSTEP
- agy-bridge.ts — FALLBACK 17 + LOCKSTEP
- install.sh — Python fallback 17 + 4-pass + guard <16
- plugins/agy-bridge.test.ts — 8 bases, 16 ids, parity test
- scripts/sync-models.test.ts — 17/8/16

## Risks

None.
