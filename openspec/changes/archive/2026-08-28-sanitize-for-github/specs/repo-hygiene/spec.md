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
