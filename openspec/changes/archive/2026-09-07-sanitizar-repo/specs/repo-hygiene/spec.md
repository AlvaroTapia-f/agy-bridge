# Delta for repo-hygiene

## ADDED Requirements

### Requirement: Scoped Lint and Format Gate

The system MUST configure `deno.json` to exclude `openspec/changes/archive/**` from lint and format checks. Active code MUST produce zero `deno lint` findings. Files CREATED by this change MUST pass `deno fmt --check`. Files MODIFIED (not created) by this change MUST NOT introduce formatting regressions relative to HEAD.

**Baseline note**: The repository was never `deno fmt --check`-clean prior to this change. A mass reformat of the active tree is a non-goal. The format gate is therefore a create-only gate with a no-regressions clause on modified files.

#### Scenario: Archive excluded from lint

- GIVEN `deno.json` contains `lint.exclude` including `openspec/changes/archive/**`
- WHEN `deno lint` runs
- THEN it MUST NOT report findings in archived files
- AND it MUST report zero findings on active code

#### Scenario: Create-only format gate with no-regressions clause

- GIVEN `deno.json` contains `fmt.exclude` including `openspec/changes/archive/**`
- AND the set of files CREATED by this change is identified via `git diff --diff-filter=A --name-only` against the change base
- AND the set of files MODIFIED (not created) by this change is identified via `git diff --diff-filter=M --name-only` against the change base
- WHEN `deno fmt --check` runs on each set
- THEN every file in the CREATED set MUST pass `deno fmt --check`
- AND the set of files in the MODIFIED set that fail `deno fmt --check` now but passed at HEAD (failing-now MINUS failing-at-HEAD) MUST be empty
- AND the gate MUST NOT require the wider active tree to be fmt-clean (baseline was never fmt-clean; mass reformat is a non-goal)

## MODIFIED Requirements

### Requirement: Documentation Accuracy

README model counts, installer behavior descriptions, and inline code comments MUST accurately reflect the current system state. Stale comments describing removed or superseded behavior MUST be updated or removed. Installer documentation and test scripts MUST NOT reference removed Python fallback behavior or stale model counts.
(Previously: covered README model counts and inline code comments only; did not cover installer wording accuracy.)

#### Scenario: README counts match reality

- GIVEN the current `FALLBACK_MODELS` set produces 8 bases and 16 grouped ids
- WHEN the README states base/id counts
- THEN the stated counts MUST match the actual numbers (not the stale 7/14)

#### Scenario: No stale behavior comments

- GIVEN code comments describing streaming behavior (e.g. autonomous-stream one-chunk comment at agy-bridge.ts L908-911)
- WHEN the described behavior has been superseded
- THEN the comments MUST be updated to match current behavior or removed

#### Scenario: Installer wording accuracy

- GIVEN `install.sh` and test scripts reference model fallback behavior
- WHEN inspecting installer documentation and test assertions
- THEN they MUST NOT reference the removed Python fallback generator or stale "14 default models" wording
- AND they MUST state the verified 8 bases/16 ids contract
