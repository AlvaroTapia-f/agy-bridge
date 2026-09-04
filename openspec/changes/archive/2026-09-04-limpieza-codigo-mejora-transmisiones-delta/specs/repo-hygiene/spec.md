# Delta for repo-hygiene

## ADDED Requirements

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
