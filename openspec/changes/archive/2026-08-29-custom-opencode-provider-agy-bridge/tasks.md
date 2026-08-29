# Tasks: custom-opencode-provider-agy-bridge

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 180–260 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Provider + plugin + auth + docs | PR 1 single | `deno check agy-bridge.ts && deno test` | `curl -H "Bearer $AGY_TOKEN" http://127.0.0.1:7421/v1/models && opencode models` | Remove `provider.agy-bridge`, delete `plugins/agy-bridge.ts`, delete `auth.json:agy-bridge` |

## Phase 1: Foundation — Provider & Auth

- [x] 1.1 Add `provider.agy-bridge` to `~/.config/opencode/opencode.json` (`npm:"@ai-sdk/openai-compatible"`, `baseURL:"http://127.0.0.1:7421/v1"`, `plugin` ref) | Files: `~/.config/opencode/opencode.json` | Acceptance: `opencode models` lists `auto-ro/rw-*`, no bare ids [Spec: Provider visible, No bare ids; Correct routing]
- [x] 1.2 RED `deno test` for `stripEffortSuffix` — `gemini-3.7-flash-high→base+high`, `claude-sonnet-4-6→no variant` must fail before 2.1 | Files: plugin test helper | Acceptance: RED fails, GREEN after 2.1 [Spec: Live enumeration]
- [x] 1.3 Doc auth flow `auth.json` via `/connect Other→agy-bridge` (`type:api`,600) + alt `"{env:AGY_TOKEN}"`, no literal | Files: `README.md`,`install.sh` | Acceptance: repo grep token=0, `auth.json` 600 [Spec: Auth succeeds; No secret in repo]

## Phase 2: Core — Plugin `~/.config/opencode/plugins/agy-bridge.ts`

- [x] 2.1 Implement `groupBases`+`variantSubsets` — strip `{-high,-medium,-low,-thinking}`, singletons→`{}` | Files: `plugins/agy-bridge.ts` | Acceptance: 14 FALLBACK→14 bases, picker shows `high/medium/low` [Spec: Picker]
- [x] 2.2 Implement `wireModel(b,v)`=`v?`${b}-${v}`:b` validated by `parseAutoModel` | Files: `plugins/agy-bridge.ts` | Acceptance: `auto-ro-gemini-3.7-flash+high`→`auto-ro-gemini-3.7-flash-high` [Spec: Suffixed wire id]
- [x] 2.3 Provider hook `models(p,ctx)` — `GET /v1/models` with Bearer fallback 14→28 `auto-ro/rw-*` + `variants` | Files: `plugins/agy-bridge.ts` | Acceptance: live→`auto-ro/rw-<slug>`, unreachable→28 ids [Spec: Live enumeration, Fallback]
- [x] 2.4 Fetch wrapper for `127.0.0.1:7421/v1/chat/completions` — if `variant` then `model=wireModel(model,variant)`, try/catch | Files: `plugins/agy-bridge.ts` | Acceptance: `high`→suffixed wire, no variant→verbatim, no bare ids [Spec: Suffixed wire id; No bare ids]

## Phase 3: Integration & Docs

- [x] 3.1 Update `install.sh` — append provider snippet if missing, echo `/connect` + `curl` verify | Files: `install.sh` | Acceptance: fresh run shows verify steps [Spec: Fresh-machine restore]
- [x] 3.2 Update `README.md` — provider, auth (600), `baseURL /v1`+Host, verify, rollback | Files: `README.md` | Acceptance: clean machine README→`opencode models` shows `auto-*` [Spec: Fresh-machine restore; No secret]

## Phase 4: Verification & Rollback

- [x] 4.1 Verify auth+routing — `curl Bearer $AGY_TOKEN /v1/models→200`, `Host:evil.com→403`, no Bearer→401, `opencode models` only `auto-*` | Files: `plugins/agy-bridge.ts` | Acceptance: [Spec: Happy verification; Missing auth; Spoofed host; No bare ids]
- [x] 4.2 Verify E2E completions — pick `auto-ro-gemini-3.7-flash+high` → `POST /v1/chat/completions` stream+non-stream → `choices[0].message.content` | Files: `plugins/agy-bridge.ts` | Acceptance: both streams succeed suffixed [Spec: Happy verification; Suffixed wire id]
- [x] 4.3 Verify rollback+secret — remove provider+auth, restart→no `agy-bridge/*`; `grep AGY_TOKEN repo=0` | Files: `opencode.json`,`auth.json` | Acceptance: [Spec: Clean rollback; No secret in repo]
