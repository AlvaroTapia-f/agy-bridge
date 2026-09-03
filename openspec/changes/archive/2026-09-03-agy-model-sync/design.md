# Design: AGY Model Sync

## Technical Approach

Standalone `scripts/sync-models.ts` reuses exported helpers from `plugins/agy-bridge-helpers.ts` (`stripEffortSuffix`, `groupBases`, `buildModelMap`, `FALLBACK_MODELS`). Three-tier resolution: `agy models` TSV → `GET /v1/models` → `FALLBACK_MODELS`. **Effort variants are computed dynamically from the live slugs** — `stripEffortSuffix`/`groupBases` infer `high/medium/low/thinking` (and any future effort such as `ultra`) per base at sync time, so new efforts from `agy` are exposed automatically without touching `EFFORT_SUFFIXES` or `FALLBACK_MODELS`; the offline fallback path remains behaviorally identical to today for the current 15-entry list. Atomic tmp+rename on `~/.config/opencode/opencode.json`. Installer (`install.sh`) replaces inline Python model generation with a `deno run` call to the sync script, keeping Python as graceful fallback only if Deno is somehow unavailable.

## Architecture Decisions

| Decision | Options | Tradeoff | Choice |
|---|---|---|---|
| Script location | `plugins/sync-models.ts` / `scripts/sync-models.ts` | Scripts dir separates CLI tools from opencode plugin runtime | `scripts/sync-models.ts` — avoids plugin loader confusion |
| TSV parsing | Spawn `agy models` / read env / hardcode | Spawn is the only reliable live source | Spawn `agy models`, parse TSV `id` column |
| Fallback chain order | TSV-first / API-first / parallel | TSV gives canonical slugs without auth; API needs bridge running | TSV → API → FALLBACK_MODELS |
| JSON update strategy | Full overwrite / RMW key / jq | RMW preserves other providers; jq adds dependency | Read-modify-write `provider["agy-bridge"].models` only |
| Installer integration | Replace Python entirely / Deno-first + Python fallback | Python fallback protects no-Deno edge case | Deno sync primary; Python retained as fallback guard |
| Deno task entry | CLI args only / deno.json task | Task gives ergonomic `deno task sync:models` | Add `sync:models` to `deno.json` tasks |

## Data Flow

```
agy models (TSV)  ─┐
                    ├─ parseSlugs() ─→ string[]
GET /v1/models    ─┘                      │
FALLBACK_MODELS   ─ (last resort) ────────┘
                                          │
                              groupBases() ─→ Map<base, Set<variant>>
                                          │
                              buildModelMap() ─→ Record<id, ModelEntry>
                                          │
                      ┌───────────────────┘
                      ▼
         readJSON(opencode.json)
                      │
         config.provider["agy-bridge"].models = modelMap
                      │
         writeTmp → rename (atomic)
```

## File Changes

| File | Action | Description |
|---|---|---|
| `scripts/sync-models.ts` | Create | Sync script: TSV parse, fetch fallback, atomic JSON update, dry-run, CLI entry |
| `plugins/agy-bridge-helpers.ts` | Evaluate | Already exports helpers but `EFFORT_SUFFIXES` is hardcoded `["high","medium","low","thinking"]`. If a new effort appears in `agy models`, it must still be captured as a variant. Extend `stripEffortSuffix` to treat any trailing `-<token>` as effort when it yields a grouped base, or keep the constant as baseline and let sync infer unknown suffixes dynamically (update helpers only if needed to avoid missing new efforts). |
| `deno.json` | Modify | Add `tasks.sync:models` with scoped `--allow-*` permissions |
| `install.sh` | Modify | Replace inline Python model gen (L221-278) with `deno run scripts/sync-models.ts`; keep Python as Deno-unavailable fallback |
| `scripts/sync-models.test.ts` | Create | Unit tests for TSV parsing, fallback chain, atomic write, dry-run |

## Interfaces / Contracts

```typescript
// scripts/sync-models.ts — key functions

/** Parse `agy models` TSV stdout → slug list */
function parseTsv(stdout: string): string[];

/** Resolution chain: TSV → API → FALLBACK */
async function resolveSlugs(agyBin: string): Promise<string[]>;

/** Read-modify-write opencode.json atomically */
async function syncModels(opts: {
  configPath: string;
  agyBin: string;
  dryRun: boolean;
}): Promise<{ count: number; source: "tsv" | "api" | "fallback" }>;
```

## Deno Permissions

| Permission | Scope | Why |
|---|---|---|
| `--allow-run=agy` | `agy models` subprocess | TSV resolution |
| `--allow-net=127.0.0.1:7421` | Bridge API fallback | `GET /v1/models` |
| `--allow-read` | `~/.config/opencode/opencode.json` | Read existing config |
| `--allow-write` | `~/.config/opencode/opencode.json` | Atomic write + `.bak` |
| `--allow-env=AGY_BIN,XDG_CONFIG_HOME,HOME` | Env vars | Path resolution |

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | `parseTsv` with valid/malformed/empty TSV | `deno test scripts/sync-models.test.ts` — pure function, no I/O |
| Unit | Fallback chain ordering (TSV fail → API → FALLBACK) | Mock subprocess + fetch; verify source in result |
| Unit | Atomic write: tmp+rename, `.bak` creation, other providers preserved | Write to temp dir, verify JSON structure |
| Unit | Dry-run: stdout output, no file mutation | Capture stdout, assert no writes |
| Integration | `install.sh` calls sync script successfully | `tests/install-remote.test.sh` extension or new test |
| E2E | Full sync with live bridge | Manual: `deno task sync:models && opencode models | grep agy-bridge` |

## Threat Matrix

| Boundary | Applicability | Design response | Planned RED tests |
|---|---|---|---|
| Documentation-like paths | N/A — no executable classification; only reads/writes JSON config | — | — |
| Git repository selection | N/A — no git operations | — | — |
| Commit state | N/A — no git operations | — | — |
| Push state | N/A — no git operations | — | — |
| PR commands | N/A — no PR automation | — | — |
| **Subprocess execution** (extends matrix) | **Applicable** — spawns `agy models` | `AGY_BIN` resolved from env/PATH; only `agy` binary allowed by `--allow-run=agy`; stderr captured but never logged with token; non-zero exit → next fallback tier | RED: spawn with invalid binary → falls to API; spawn with timeout → falls to FALLBACK; stdout injection (malformed TSV) → parseTsv returns empty → fallback |

## Migration / Rollout

No data migration required. Existing `opencode.json` entries are overwritten by sync (additive, replaces `models` key only). The `.bak` file provides rollback. The Python fallback in `install.sh` ensures backward compatibility during transition.

## Open Questions

- [x] Prune vs additive? → Prune (full replacement of `models` key per proposal assumption)
- [x] Always sync vs flag? → Always on install (proposal assumption)
- [ ] Should `deno task sync:models` also accept `--config-path` override for testing, or always use `XDG_CONFIG_HOME`?
