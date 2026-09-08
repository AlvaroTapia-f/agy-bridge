## Exploration: Repository sanitation and redundancy audit

### Current State
`agy-bridge` is a small Deno 2.9.5 repository centered on `agy-bridge.ts`, which serves an OpenAI-compatible HTTP API and spawns the official `agy` CLI. The repository also contains an OpenCode plugin, a model synchronization script, two shell installers, agent profiles, stubs, tests, documentation, and OpenSpec history.

The functional baseline is currently healthy: `deno test` passes 56/56, `deno check` passes for the TypeScript sources, and both shell test suites pass (15 + 18 assertions). The repository is not hygiene-clean, however: `deno lint` reports 44 findings and `deno fmt --check` reports 87 unformatted files (the latter includes archived OpenSpec artifacts, so a blanket format run would be unsafe and noisy). The tracked repository contains 103 files; generated coverage and CodeGraph state are present locally but ignored and not tracked.

The main sanitation concern is duplicated model/catalog logic. `plugins/agy-bridge.ts` embeds its own fallback catalog, suffix parsing, four-pass grouping, and model-map builder so the installed plugin can remain self-contained. The same catalog and algorithms live in `plugins/agy-bridge-helpers.ts`, which is used by `agy-bridge.ts` and `scripts/sync-models.ts`. `install.sh` contains a third implementation of the fallback catalog, grouping passes, and model-map generation in an inline Python fallback. Tests intentionally assert parity between the plugin copy and helper copy, confirming the duplication is real and currently protected by drift tests rather than eliminated.

There is also a second class of cleanup: stale or weakly maintained quality signals. `scripts/sync-models.ts` imports `stripEffortSuffix` without using it; its tests import several unused symbols and contain many unnecessary `async` callbacks. The stubs use pervasive `any`, the main service uses a lint-suppression type idiom (`string & {}`), and the plugin has empty catches and async callbacks with no awaits. The shell integration test still describes the Python fallback as ensuring “14 default models” even though the current fallback produces 16 grouped ids. Current specs also retain 7/14 wording in `openspec/specs/opencode-provider/spec.md`, while the current implementation and other current specs establish 8 bases and 16 ids. Archived changes are an audit trail and should not be rewritten, but active specs and README claims need a consistency pass.

Coverage is concentrated in model helpers, plugin behavior, synchronization, and installer smoke tests. The core HTTP routing, request validation, process lifecycle/deadline handling, conversation reuse, salvage behavior, auth/host guard, and most SSE behavior in `agy-bridge.ts` have no direct test coverage according to the CodeGraph dependency survey. This makes broad refactoring risky even though the existing tests are green.

### Affected Areas
- `agy-bridge.ts` — Core HTTP service, process lifecycle, autonomous routing, raw routing, SSE, auth/host guards, conversation state, and usage logging; the largest untested blast radius.
- `plugins/agy-bridge.ts` — Self-contained OpenCode plugin with duplicated catalog/grouping/model-map logic, global fetch monkey patching, variant state, and empty error handling.
- `plugins/agy-bridge-helpers.ts` — Shared model/catalog and streaming helpers; candidate canonical home for model logic, but its importability from the installed plugin must be preserved or explicitly redesigned.
- `scripts/sync-models.ts` — Model resolution and atomic config update; contains an unused import and broad `any` config typing, and is the reusable path that should own synchronization behavior.
- `install.sh` — 532-line installer combining environment setup, agents, systemd, provider mutation, model sync, Python fallback logic, auth migration, and an external TUI patch; the clearest source of redundant policy and difficult review.
- `install-remote.sh` — Thin bootstrap with destructive `--force` re-cloning and curl/tar/git fallback behavior; needs security and portability review, not just formatting.
- `tests/install.test.sh` — Good smoke coverage but stale “14 default models” language and broad `|| true` usage can hide installer failures.
- `tests/install-remote.test.sh` — Exercises bootstrap branches through mocks, but relies on shell text substitution and does not validate archive/ref safety deeply.
- `plugins/agy-bridge.test.ts` — 37 tests include historical “RED test” labels and parity tests that preserve duplicated plugin logic; should be reorganized after the runtime design is settled.
- `scripts/sync-models.test.ts` — 19 tests cover fallback and atomic writes but contain unused imports and repetitive async mocks.
- `stubs/opencode-plugin.ts` and `stubs/opencode-sdk-v2.ts` — Local compatibility stubs; the plugin stub is intentionally permissive but prevents a clean lint baseline through `any`.
- `README.md` — Large Spanish operational document with model counts, installer behavior, TUI patch details, permissions, and rollback instructions; must be checked against current code without silently changing the project’s user-facing language.
- `openspec/specs/*.md` — Active specification source; `opencode-provider` contains stale 7-base references that conflict with current implementation and `repo-hygiene`/`model-sync` expectations.
- `deno.json`, `.gitignore`, `agy-bridge.service.template`, `.env.example` — Tooling, ignored-state, permission, and deployment contracts that must remain aligned while consolidating code.
- `openspec/changes/archive/**` — Historical audit trail; stale historical claims are expected and should not be “sanitized” by rewriting archived artifacts.

### Approaches
1. **Incremental hygiene slices with a preserved behavior baseline** — First establish a narrow quality gate and inventory, then remove obvious dead code and stale references, consolidate model logic where runtime loading permits, and separately simplify installer responsibilities. Add characterization tests around service and installer behavior before changing shared seams.
   - Pros: Lowest regression risk; keeps each change reviewable under the 400-line budget; makes stale documentation and actual behavioral changes distinguishable; supports rollback by slice.
   - Cons: Temporary coexistence of old and new paths; requires explicit sequencing and repeated verification.
   - Effort: Medium/High

2. **Immediate architectural consolidation** — Make one canonical TypeScript model library, make the plugin import it, remove the inline Python model generator, and reduce `install.sh` to orchestration around the Deno sync command.
   - Pros: Removes the largest duplication quickly and gives one source of truth for catalogs, grouping, and model shape.
   - Cons: Plugin loader compatibility is an explicit historical constraint; installed-plugin import resolution is not covered by current tests. A failed consolidation can break model discovery or clean installs, and the combined diff is likely to exceed the review budget.
   - Effort: High

### Recommendation
Use Approach 1, with the model/catalog duplication as the first architectural decision rather than assuming it can be deleted. Start by documenting and testing the supported installed-plugin loading contract, then choose between a truly self-contained generated plugin artifact and a shared importable module. In parallel, create a single model-sync contract used by Deno and make the Python fallback either a deliberately minimal emergency path or remove it only after proving Deno is a hard prerequisite. The first implementation slices should be: (1) baseline and lint/format scope, (2) dead code and test cleanup, (3) model-source consolidation, (4) installer decomposition/security review, (5) documentation/spec reconciliation, and (6) service coverage.

Do not mass-format the repository or rewrite archived OpenSpec documents. Treat the active 7/14 spec wording, stale test wording, README claims, and installer behavior as separate discrepancies; correct active artifacts only after confirming the intended 8/16 contract.

### Risks
- The plugin is deliberately self-contained because historical requirements protected it from missing helper imports; removing embedded logic without an installed-plugin smoke test can break real OpenCode discovery.
- The inline Python fallback is behaviorally significant on machines where Deno sync fails; deleting it without an explicit prerequisite policy can make installation silently incomplete.
- `install.sh` mutates user-global OpenCode config, auth, cached TUI code, agent files, and systemd state; refactoring it can cause destructive or non-atomic migrations.
- `install-remote.sh --force` deletes an existing target tree before re-fetching; sanitation should review this recovery path independently from ordinary cleanup.
- Core process and SSE behavior has limited direct coverage, so moving helpers or changing stream plumbing can regress deadlines, cancellation, tool-call parsing, or final-response delivery.
- Current lint and format failures span both production/test code and archived artifacts; treating every finding as one cleanup change will create a large, low-signal diff.
- Active specs and README may encode different historical states; implementation must follow verified current behavior and preserve archived documents as immutable history.
- External TUI patching is version/path-sensitive and may become obsolete upstream; changing or removing it requires a live compatibility check, not only static cleanup.

### Ready for Proposal
Yes. The proposal should define repository sanitation as a staged effort with explicit non-goals (no archive rewriting, no behavior change without characterization tests), establish the current 56-test/clean-typecheck baseline, and make the plugin loading contract plus Python fallback policy decision points before implementation. The likely scope is large enough to require chained PR slices under the 400-line review budget.
