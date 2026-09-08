# Repository Hygiene Specification

## Purpose

Establish standards for repository tracking, licensing, and file portability to ensure the project can be safely shared and published.

## Requirements

### Requirement: Ignored State

The repository MUST prevent environment configuration, IDE state, cache directories, and local execution state from being tracked.

#### Scenario: Git tracks only intentional files

- GIVEN a properly configured `.gitignore` file
- WHEN the developer creates a `.env` file, Deno cache, or opens the project in an IDE
- THEN git MUST ignore these files and prevent them from being committed

### Requirement: Project Licensing

The repository MUST include a valid Open Source license.

#### Scenario: License identification

- GIVEN the root of the repository
- WHEN a user inspects the project files
- THEN an MIT `LICENSE` file MUST be present

### Requirement: Path Generalization

The project MUST NOT rely on hardcoded absolute paths for system binaries or configurations.

#### Scenario: Dynamic binary path resolution

- GIVEN the service template (`agy-bridge.service.template`)
- WHEN the service executes commands
- THEN it MUST use environment-driven variables (e.g., `$DENO_BIN`, `$AGY_BIN`) instead of absolute system paths

#### Scenario: No absolute /usr/sbin paths in tracked files

- GIVEN the sanitized repository
- WHEN running `grep -rn '/usr/sbin' --include='*.ts' --include='*.service*' --include='*.md' .`
- THEN it MUST return zero matches for hardcoded absolute paths (only docs referencing placeholders allowed)

### Requirement: Agent Bundling

The repository MUST bundle foundational agent configurations as reference examples.

#### Scenario: Shipped example agents

- GIVEN the cloned repository
- WHEN the user inspects the `agents/` directory
- THEN they MUST find `raw`, `worker-ro`, and `worker-rw` agent configurations available for copying

#### Scenario: Agents are documented

- GIVEN the README manual install section
- WHEN a user follows it
- THEN it MUST explain where to copy agents (`~/.gemini/config/agents/<name>/agent.md`)

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

### Requirement: Documentation Accuracy

README model counts, installer behavior descriptions, and inline code comments MUST accurately reflect the current system state. Stale comments describing removed or superseded behavior MUST be updated or removed. Installer documentation and test scripts MUST NOT reference removed Python fallback behavior or stale model counts.
(Previously: covered README model counts and inline code comments only; did not cover installer wording accuracy.)

#### Scenario: README counts match reality

- GIVEN the current `FALLBACK_MODELS` set produces 7 bases and 14 grouped ids
- WHEN the README states base/id counts
- THEN the stated counts MUST match the actual numbers (not the superseded 8/16; the current 7/14 was verified live against `GET /v1/models` on 2026-09-07 after upstream retired `gemini-3.5-flash`, and MUST NOT be confused with the retired historical 7/14 claim from before `gemini-3.8-flash` was added)

#### Scenario: No stale behavior comments

- GIVEN code comments describing streaming behavior (e.g. autonomous-stream one-chunk comment at agy-bridge.ts L908-911)
- WHEN the described behavior has been superseded
- THEN the comments MUST be updated to match current behavior or removed

### Requirement: Dead State Elimination

The codebase MUST NOT contain written-but-never-read state maps or variables. Unused declarations MUST be removed to prevent maintenance burden.

#### Scenario: No dead maps

- GIVEN the service and plugin source files
- WHEN analyzing variable read/write usage
- THEN every declared map or state variable MUST be read at least once (e.g. `variantBySession` MUST be removed)
