# Secret Management Specification

## Purpose

Define the requirements for managing sensitive credentials securely outside the source code, preventing leaks in version control.

## Requirements

### Requirement: Token Externalization

The system MUST load the application token from an external environment variable configuration file rather than hardcoded service definitions.

#### Scenario: Service reads token from environment file

- GIVEN the service is configured to use `EnvironmentFile`
- WHEN the service starts up
- THEN it MUST read the `AGY_TOKEN` from the specified environment file
- AND the service MUST authenticate successfully using the externalized token

### Requirement: Secret Documentation

The system MUST provide a template for environment configuration to guide users during installation.

#### Scenario: User copies environment template

- GIVEN the repository contains a `.env.example` file documenting required variables
- WHEN a user sets up the project
- THEN they CAN copy `.env.example` to `.env` and fill in their actual token

### Requirement: Token Leak Prevention

The repository MUST NOT contain the bearer token in its commit history or active tracking.

#### Scenario: Verification script execution

- GIVEN the repository is prepared for publishing
- WHEN a verification tool runs `grep` for the leaked token string
- THEN it MUST return zero matches across all tracked files

#### Scenario: Git history is clean

- GIVEN a new clean repository without old history
- WHEN running `git log --all -p | grep -c '7144bf7b'`
- THEN it MUST return 0
