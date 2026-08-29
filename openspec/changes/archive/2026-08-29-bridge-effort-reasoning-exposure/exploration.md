# Exploration: bridge-effort-reasoning-exposure

---
execution_mode: interactive
artifact_store.mode: openspec
delivery_strategy: ask-on-risk
review_budget_lines: 400
---

## Current State

**User report:** Setting reasoning `effort` on model `agy-bridge/auto-rw-gemini-3.7-flash` via SDD config (opencode TUI / `opencode-sdd-engram-manage` plugin) fails with:

> `Model agy-bridge/auto-rw-gemini-3.7-flash does not expose reasoning effort options.`

The error string was traced to `opencode-sdd-engram-manage` TUI distribution:

```
/home/alvaro/.cache/opencode/packages/opencode-sdd-engram-manage@latest/node_modules/opencode-sdd-engram-manage/dist/tui.js:1623
  if (state?.kind === "unsupported") return `Model ${state.modelId} does not expose reasoning effort options.`;
```

**Gating logic (tui.js `profile-reasoning.ts`):**

```js
function listReasoningEffortsFromModel(modelDef) {
  if (!modelDef || modelDef?.capabilities?.reasoning !== true) return [];
  const variants = modelDef?.variants;
  if (!variants || typeof variants !== "object") return [];
  const values = Object.values(variants).map(v => typeof v?.reasoningEffort === "string" ? v.reasoningEffort.trim() : "").filter(Boolean);
  return Array.from(new Set(values)).sort();
}
function buildReasoningEditState(providers, agentName, modelId, current) {
  if (!modelId) return { kind: "missing-model", agentName };
  const modelDef = resolveModelDefinition(providers, modelId);
  const options = listReasoningEffortsFromModel(modelDef);
  if (options.length === 0) return { kind: "unsupported", agentName, modelId };
  return { kind: "selectable", agentName, modelId, options, ... };
}
```

Requirements for `reasoningEffort` to be editable:
1. `modelDef.capabilities.reasoning === true`
2. `modelDef.variants` values contain `{ reasoningEffort: "<effort>" }` strings

Both fail for agy-bridge today.

**How agy-bridge models are defined today:**

*Source A — plugin dynamic hook (`~/.config/opencode/plugins/agy-bridge.ts` / `plugins/agy-bridge.ts` helpers):*

- `FALLBACK_MODELS` = 14 suffixed slugs (`gemini-3.7-flash-high/medium/low` etc.). Grouped via `groupBases()` stripping `-high/-medium/-low/-thinking` into 7 bases × 2 profiles = 14 `auto-ro/rw-<base>` ids.
- `buildModelMap()` emits:
  ```ts
  out[id] = { id, name: id, variants: { high:{}, medium:{}, low:{} } }
  ```
  Empty objects, no `reasoningEffort`, no `capabilities`.

*Source B — static fallback in `opencode.json` / `install.sh:247`:*

```python
vmap = {v: {} for v in variants}
models[id_] = {"name": id_, "variants": vmap}
```

Identical shape. No `capabilities` key, no `reasoningEffort` inside variants.

*Example actual installed state (`~/.config/opencode/opencode.json` `provider.agy-bridge.models`):*

```json
"auto-rw-gemini-3.7-flash": { "name": "auto-rw-gemini-3.7-flash", "variants": { "high":{}, "low":{}, "medium":{} } }
"auto-ro-claude-sonnet-4-6": { "variants": {} }
```

`opencode models` confirms only bare grouped ids are exposed; `GET /v1/models` from bridge returns suffixed wire ids, but the plugin strips suffixes for the TUI and rewrites via fetch wrapper.

**SDD effort wiring (opencode.json):**

- Per-agent config: `agent.<name>.model = "agy-bridge/auto-rw-gemini-3.7-flash"` plus `agent.<name>.reasoningEffort` and `agent.<name>.options.reasoningEffort` (set by `applyAgentReasoningEffort` in TUI). All primary SDD agents (`sdd-*`, `gentle-orchestrator`, fallback families) are managed; legacy names canonicalized.
- Profile persistence: `profile-reasoning.ts` `applyProfileReasoningEffort` writes `profile.configs[agent].reasoningEffort` then copies to `nextConfig.agent[agent].reasoningEffort/options`. If `listReasoningEffortsFromModel` returns empty or the saved effort not in `options`, the agent's effort is *cleared* and a warning emitted (`missing runtime metadata` / `incompatible`).
- Therefore setting effort on agy-bridge currently: TUI blocks edit; direct JSON edit is cleared on next profile apply.

**Bridge execution path ignores effort entirely:**

- `agy-bridge.ts` `runAgy()` spawns `agy --agent <agent> --model <real> --input-format stream-json --output-format stream-json --print-timeout ...` — no `--effort` flag ever passed.
- `agy --help` shows `--effort (low|medium|high)` per CLI session, and `agy models` lists suffixed models like `gemini-3.7-flash-high`. The suffix *is* the effort encoding; bridge uses `parseAutoModel()` + `modelSlugs` to validate `auto-rw-gemini-3.7-flash-high` as `real=gemini-3.7-flash-high`.
- The `auto-*` variant suffix mechanism (fetch wrapper `wireModel(base, variant)`) and the SDD `reasoningEffort` field are currently disjoint: variant picker drives wire suffix; SDD effort field is never read by the bridge.

## Affected Areas

- `plugins/agy-bridge.ts` + `plugins/agy-bridge-helpers.ts` — source for both dynamic `provider` hook and installed `~/.config/opencode/plugins/agy-bridge.ts`. Must add `capabilities` and `reasoningEffort` inside `variants` to satisfy TUI gating. Also source for `FALLBACK_GROUPED` default-variant logic.
- `~/.config/opencode/plugins/agy-bridge.ts` (deployed copy) — immediately affects user; must stay in sync with repo `plugins/` or `install.sh` will overwrite on next run.
- `install.sh:219-253` — Python `provider.agy-bridge.models` generation for static fallback when `GET /v1/models` unreachable. Currently writes `{variant: {}}`; needs same `reasoningEffort` + `capabilities` shape.
- `~/.config/opencode/opencode.json` `provider.agy-bridge` block — static models object consumed when plugin not yet loaded or on cold start; must be regenerated/migrated to include `capabilities.reasoning` and `variants.<effort>.reasoningEffort`.
- `agy-bridge.ts` — currently ignores `reasoningEffort`/`variant` param; needs decision on whether to map SDD effort to agy `--effort` CLI flag or to keep suffix-only contract. Also handles `OAIChatRequest` (`[k:string]: unknown`) so raw `reasoningEffort`/`reasoning_effort`/`effort` fields in POST body would silently pass through today.
- `openspec/specs/opencode-provider/spec.md` — Requirement `Effort Variants` currently specifies `variants: {high,medium,low}` empty but `Reasoning (PRIMARY SDD only)` is implicit. Spec must be updated to declare `capabilities.reasoning` and variant `reasoningEffort` shape. The spec's deviation note (14 vs 28) is unaffected.
- `opencode-sdd-engram-manage` TUI (`tui.js` distribution at `~/.cache/opencode/packages/...`) — external, not edited, but its `listReasoningEffortsFromModel` contract is the root cause. Must not be patched; bridge side must conform.
- `~/.config/opencode/node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts` — documents expected model shape: `models[key].reasoning?` / `capabilities.reasoning` (provider metadata) vs `models[key].variants[key].reasoningEffort`. Useful as reference, not a code change.
- `plugins/agy-bridge.test.ts` — existing tests assert `variants: {high,medium,low}` empty; must be updated if `variants` gain `reasoningEffort` values.
- `openspec/config.yaml` / `ops` docs — no change; bridge still single-file Deno service, permissions unchanged (`--allow-net=127.0.0.1 --allow-run --allow-env`).

## Approaches

### 1. Advertise reasoning correctly — add `capabilities.reasoning` + `variants.<effort>.reasoningEffort` (RECOMMENDED)

Make agy-bridge models conform to the TUI's `listReasoningEffortsFromModel` contract so effort becomes editable and persisted without TUI fork.

**Plugin change (`plugins/agy-bridge-helpers.ts` → `buildModelMap`):**

```ts
function buildModelMap(bases: Map<string, Set<string>>): Record<string, unknown> {
  for (const [base, variants] of bases) {
    for (const profile of ["ro","rw"] as const) {
      const id = `auto-${profile}-${base}`;
      const variantMap: Record<string, { reasoningEffort: string }> = {};
      for (const v of variants) variantMap[v] = { reasoningEffort: v };
      out[id] = {
        id, name: id,
        capabilities: variants.size ? { reasoning: true } : undefined,
        variants: variantMap,
      };
    }
  }
}
```

- Singleton `claude-sonnet-4-6` (no variants) => `capabilities` absent or `reasoning:false` → correctly shows "does not expose" (intended — it has no effort). Alternatively give empty variants with no capabilities.
- `claude-opus-4-6-thinking` (variant `thinking`) => `{ thinking: { reasoningEffort: "thinking" } }` with `reasoning:true`.
- Update `install.sh` Python generator identically.
- Update `plugins/agy-bridge.test.ts` assertions to expect `{ reasoningEffort: "high" }` etc.
- Keep existing fetch wrapper default-variant fallback (`medium→high→low→thinking`) unchanged — it already handles bare `auto-rw-gemini-3.7-flash` without variant by injecting default suffix. Now SDD `reasoningEffort` also drives suffix if user sets it via profile (TUI will persist `reasoningEffort: "high"` in `agent.<name>`).

**Bridge-side effort forwarding (optional, low-risk extension):** In `handleChat`/`handleAutonomousChat`, read `body.reasoningEffort || body.reasoning_effort || body.effort` or `agentConfig.reasoningEffort` forwarded via chat API, and if model base supports effort suffix, either (a) validate it matches suffix or (b) pass `--effort` to `runAgy()` when model is bare (if agy supports bare + effort). Currently agy requires suffixed model name; `--effort` is alternative CLI flag for bare models in some agy versions. Keep suffix as canonical; treat reasoningEffort as alias to variant for compatibility (e.g., if client sends `model: auto-rw-gemini-3.7-flash` + `reasoningEffort: high`, rewrite to `auto-rw-gemini-3.7-flash-high`).

- Pros: Minimal, spec-compliant, fixes user's immediate error (picker becomes selectable, effort persists into `opencode.json`), no TUI fork, backward compatible (empty variants become enriched), satisfies `opencode-sdd-engram-manage` contract exactly, keeps bridge anti-baneo invariants.
- Cons: Requires regenerating `~/.config/opencode/opencode.json` static models on existing installs (migration step); variant names must align 1:1 with `reasoningEffort` values (they already do — `high/medium/low/thinking`). Singleton models intentionally remain unsupported for effort — user-visible "unsupported" remains correct there.
- Effort: Low — ~20 lines in helpers + install.sh + test update; no Deno permission change.

### 2. Suppress / gracefully handle the SDD effort error without advertising capabilities

Change SDD flow to not require `capabilities.reasoning` for agy-bridge, or make the TUI treat empty `variants: {}` as implicitly supporting effort, or add a bridge-specific bypass in `applyProfileReasoningEffort`.

- Approach: Fork/patch `opencode-sdd-engram-manage` TUI (local override in `~/.config/opencode/plugins/` or upstream PR) to change `listReasoningEffortsFromModel` to fall back to variant keys when `capabilities.reasoning` missing, or to treat agy-bridge provider as special case.
- Pros: No model definition change if variants intentionally empty.
- Cons: Wrong layer — the provider *should* advertise capabilities; suppressing the error hides the misconfiguration and leaves `reasoningEffort` unsaved/cleared on next profile sync (warnings path). Requires TUI distribution patch that is cache-invalidated on `opencode` upgrade (`~/.cache/opencode/.../tui.js` is ephemeral). Violates SDD principle that model metadata is source of truth.
- Effort: Medium — TUI patch + cache survival strategy.

### 3. Map SDD `reasoningEffort` to agy `--effort` CLI flag (bridge execution change only)

Keep model advertisement as-is (empty variants) but make bridge forward `reasoningEffort` to `agy --effort <value>` so effort still has runtime effect even if TUI blocks editing.

- Patch `agy-bridge.ts:runAgy()` to accept `effort?: string` and include `--effort <effort>` in spawn args when provided; `handleChat` extracts `reasoningEffort` from request body or from `provider.options`.
- Pros: Makes effort actually affect agy execution if bare model + effort flag is supported by agy binary.
- Cons: Does not fix TUI error — user still cannot save effort via SDD UI. `--effort` support in agy is undocumented per version; suffix-based models may ignore it or conflict. Adds spawn arg surface without solving advertisement bug.
- Effort: Low but incomplete alone.

### 4. Dual exposure: both suffix models and capabilities (compatibility max)

Serve both flat suffixed ids *and* grouped base ids simultaneously, so older clients using bare suffix ids keep working while new TUI uses `capabilities+variants`.

- Keep existing `FALLBACK_MODELS` flat ids; plugin exposes both `auto-rw-gemini-3.7-flash` (with variants/capabilities) *and* `auto-rw-gemini-3.7-flash-high` as distinct model ids.
- Pros: Maximal backward compat for scripts that hardcode suffixed ids.
- Cons: Violates `opencode-provider` spec Requirement `No bare ids` / `Flat ids forbidden`; doubles model list (14 → 28) creating picker noise; spec already rejected flat 28 in deviation note; migration complexity.
- Effort: Medium, spec-violating.

## Recommendation

**Approach 1 as the implementation for this change, with element of Approach 3 as optional follow-through.**

Rationale: The error is a *metadata advertisement* bug, not a bridge execution bug. `opencode-sdd-engram-manage` correctly implements `listReasoningEffortsFromModel` per opencode provider spec (`capabilities.reasoning` + `variants.<k>.reasoningEffort`). `agy-bridge`'s current `{ high: {} }` is non-conformant and therefore filtered to `unsupported`. Fixing the provider hook to emit `{ high: { reasoningEffort: "high" } }` and `capabilities: { reasoning: true }` (for bases with variants) is the smallest, spec-compliant correction. It immediately makes `agy-bridge/auto-rw-gemini-3.7-flash` selectable for effort and persists the star-selected effort into `agent.*.reasoningEffort` / `options.reasoningEffort`.

After advertisement is fixed, optionally make bridge forward the persisted `reasoningEffort` as `--effort` or as suffix rewrite fallback for bare-base sends. But the user-facing bug is resolved by advertisement alone; the suffix mechanism already delivers effort via wire model `auto-rw-gemini-3.7-flash-high`.

**Proposed file changes for `sdd-propose`:**
- `plugins/agy-bridge-helpers.ts`: `buildModelMap` → enrich `variantMap` and add `capabilities`.
- `plugins/agy-bridge.ts` (deployed copy): same + re-copy via `install.sh`.
- `install.sh`: Python static-model generator → same enrichment.
- `~/.config/opencode/opencode.json`: regenerated via `install.sh` or manual `python3` patch; or document migration (`./install.sh` re-run is idempotent, already does upsert `preserveExisting`).
- `plugins/agy-bridge.test.ts`: update assertions for `reasoningEffort` values and `capabilities`.
- `openspec/specs/opencode-provider/spec.md` delta: clarify `variants` MUST contain `reasoningEffort` and models with variants MUST set `capabilities.reasoning: true`.
- Optional `agy-bridge.ts` delta: read `reasoningEffort` from OpenAI request body and map to suffix if bare, or forward `--effort` to agy; decide in design phase whether agy suffix or `--effort` flag is canonical.

**No Deno permission change:** `--allow-net`, `--allow-run`, `--allow-env` unchanged. No `agy-bridge.ts` permission expansion needed.

## Risks

- **Migration / stale `opencode.json`:** Existing installs have static `provider.agy-bridge.models` with empty variant objects and no `capabilities`. Re-running `install.sh` (idempotent) with `preserveExisting=false` for provider block or a targeted migration script is required; otherwise TUI will keep reading stale metadata until cache cleared. Document `opencode models` refresh behavior (`provider` hook is live via `resolveSlugs` but static `models` in `opencode.json` takes precedence on cold start).
- **Singleton models must remain unsupported:** `claude-sonnet-4-6` (no variants) correctly stays `unsupported` for effort. Design must not falsely advertise `reasoning: true` there, or TUI will offer an empty picker. Ensure guard `variants.size ? {reasoning:true} : undefined`.
- **Variant name ≠ reasoningEffort vocabulary drift:** If agy adds a new effort suffix outside `{high,medium,low,thinking}` (e.g., `ultra`), `EFFORT_SUFFIXES` and `FALLBACK_MODELS` must be updated together. `reasoningEffort: v` assumes 1:1 mapping; mismatch would cause `Skipped reasoning effort: incompatible` warning.
- **Two effort sources competing:** After fix, effort can be set via (a) variant picker → fetch wrapper suffix, and (b) SDD `reasoningEffort` → `agent.*` config. If both are set differently (e.g., variant `high` but `reasoningEffort: low`), wire model ambiguity arises. Proposal must define precedence: SDD `reasoningEffort` should either sync to variant (preferred — single source) or be documented as alias.
- **TUI `applyProfileReasoningEffort` clearing behavior:** If plugin temporarily returns empty/stale metadata (bridge unreachable, fallback path not yet enriched), profile sync will clear `reasoningEffort` and emit warning. Design should ensure `resolveSlugs` fallback also uses enriched capability shape.
- **`--effort` CLI flag version skew:** `agy --help` shows `--effort low|medium|high` today, but older agy binaries may not support it or may ignore it for suffixed models. Forwarding effort as `--effort` must be feature-detected or suffix-based to avoid spawn failure.
- **Supply-chain / rollback:** No network change; rollback is `install.sh` re-run with prior `FALLBACK_MODELS` or removing `capabilities/variants.reasoningEffort` and restarting opencode. No systemd change; no bridge restart needed unless `agy-bridge.ts` is patched for `--effort` forwarding.
- **`~/.cache/opencode` volatility:** TUI distribution at `~/.cache/.../tui.js` is cache-managed by opencode; do not patch it directly. Fix must live in provider metadata (stable), not TUI cache.
- **Second user problem not yet explored:** Change request title says "Tuve dos problemas" but only first (effort error) is described in context. Discovery incomplete — second problem must be elicited in proposal question round before tasks are locked.

## Ready for Proposal

Yes — ready for `sdd-propose`, with one blocking question to resolve in proposal intake: **the second problem** referenced in the change name. This exploration fully covers problem 1 (effort advertisement). Problem 2 is unspecified; proposal should ask the user to describe it before `sdd-spec`.

**Next step for orchestrator:** Tell the user:

> Exploration complete for problem 1. Root cause confirmed: `agy-bridge` models advertise `variants: { high:{} }` without `capabilities.reasoning` or `variants.*.reasoningEffort`, so `opencode-sdd-engram-manage` TUI correctly classifies them as `unsupported`. Fix is to enrich `plugins/agy-bridge.ts` / `install.sh` to emit `capabilities: {reasoning:true}` + `variants: {high:{reasoningEffort:"high"}}`. Ready to draft proposal — but your change title mentions "dos problemas" and only one is detailed here. Please describe the second problem so the proposal can scope it correctly, or confirm the change should scope to effort only.

