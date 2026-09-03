# Design: plugin-4pass-live

## Technical Approach

Port the 4-pass `groupBases` algorithm from `agy-bridge-helpers.ts` into `plugins/agy-bridge.ts` as self-contained code (proposal Option A). Append 3× `gemini-3.8-flash-{high,medium,low}` to all three `FALLBACK_MODELS` arrays (plugin, helpers, server). Port the same 4-pass + 17-slug list into the `install.sh` Python fallback. Update test assertions from 14/7/14 → 17/8/16 and add a plugin↔helpers parity test.

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|----------|--------|-------------|----------|
| Plugin grouping | Self-contained 4-pass in plugin | Shared module import; re-export wrapper | Loader sandbox forbids imports; verified empirically |
| FALLBACK sync | Triplicate arrays + `// LOCKSTEP` marker | Single source + codegen | No build step exists; lockstep comment + parity test catches drift |
| Python fallback | 4-pass port (defaultdict + prefix match) | Keep 1-pass | Spec requires Deno↔Python parity for offline 17/8/16 |
| Test count update | Exact 17/8/16 asserts | `>=` thresholds | Exact counts catch accidental additions/removals; proposal Q3 resolved |

## Data Flow

    FALLBACK_MODELS (17 slugs)
         │
    groupBases() ── 4-pass ──→ Map<base, Set<variant>>  (8 bases)
         │
    buildModelMap() ──→ Record<id, ModelV2>  (16 ids = 8×2 profiles)
         │
    provider.models hook ──→ opencode TUI

Same flow applies independently in:
- `plugins/agy-bridge.ts` (plugin sandbox — self-contained)
- `plugins/agy-bridge-helpers.ts` (used by sync-models.ts)
- `install.sh` Python fallback (offline only)

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `plugins/agy-bridge.ts` | Modify | Replace 1-pass `groupBases` (L37-45) with 4-pass algorithm (~+50 lines). Add 3× 3.8 slugs to `FALLBACK_MODELS` (L8-23). Add `// LOCKSTEP:plugin-4pass-live` marker. |
| `plugins/agy-bridge-helpers.ts` | Modify | Add 3× `gemini-3.8-flash-{high,medium,low}` to `FALLBACK_MODELS` (L1-16). Add `// LOCKSTEP:plugin-4pass-live` marker. |
| `agy-bridge.ts` | Modify | Add 3× 3.8 slugs to `FALLBACK_MODELS` (L49-64). Add `// LOCKSTEP:plugin-4pass-live` marker. |
| `install.sh` | Modify | Add 3× 3.8 slugs to Python `fallback` list (L285-291). Port 4-pass logic: pass 1 known suffixes, pass 2 prefix-match against known bases, pass 3 multi-variant prefix detection, pass 4 singletons. Update `len(existing) < 14` guard → `< 16`. |
| `plugins/agy-bridge.test.ts` | Modify | Update assertions: `grouped.size` 7→8, `Object.keys(map).length` 14→16. Add `gemini-3.8-flash` variant test. Add parity test (plugin `groupBases` ≡ helpers `groupBases` for same input). |

## Interfaces / Contracts

No new interfaces. Existing contracts preserved:

```typescript
// groupBases signature (unchanged, duplicated in plugin)
function groupBases(slugs: readonly string[]): Map<string, Set<string>>

// buildModelMap signature (unchanged)
function buildModelMap(bases: Map<string, Set<string>>): Record<string, ModelV2>
```

The 4-pass algorithm in the plugin MUST be a byte-for-byte logic copy of helpers (excluding type export decorators). Both produce identical output for identical input — enforced by parity test.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `groupBases(FALLBACK)` → 8 bases; `buildModelMap` → 16 ids | Update existing assertions in `agy-bridge.test.ts` |
| Unit | 3.8-flash variants `{high,medium,low}` | New test: `grouped.get("gemini-3.8-flash")` equals `Set(["high","medium","low"])` |
| Unit | Plugin↔helpers parity | New test: import both `groupBases`, run on same input, `assertEquals` on serialized output |
| Unit | Python 4-pass equivalence | `bash -n install.sh` syntax + manual verification that Python `grouped` matches Deno for 17 slugs |
| Integration | Provider hook fallback | Existing test (L80-97) already covers; will now return 16 ids |

No new Deno permissions required — all existing `--allow-*` flags suffice.

## Threat Matrix

N/A — no new routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. The `install.sh` Python block already exists; we modify data and algorithm within the existing boundary, not the boundary itself.

## Migration / Rollout

No migration required. Adding models is additive. Existing `opencode.json` entries remain valid; re-running `install.sh` or `sync-models.ts` picks up new models. The `len(existing) < 14` → `< 16` guard ensures Python fallback overwrites stale 14-model configs.

## Open Questions

- None — all proposal questions (Q1-Q3) resolved by spec phase.
