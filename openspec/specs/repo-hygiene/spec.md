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

### Requirement: Documentation Accuracy

README model counts and inline code comments MUST accurately reflect the current system state. Stale comments describing removed or superseded behavior MUST be updated or removed.

#### Scenario: README counts match reality

- GIVEN the current `FALLBACK_MODELS` set produces 8 bases and 16 grouped ids
- WHEN the README states base/id counts
- THEN the stated counts MUST match the actual numbers (not the stale 7/14)

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
