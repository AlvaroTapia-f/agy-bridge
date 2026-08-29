# Install Automation Specification

## Purpose

Define the requirements for automated and manual setup of the service to ensure consistent and reproducible deployments across Linux environments.

## Requirements

### Requirement: Installation Script Workflow

The installation script (`install.sh`) MUST automate the detection of dependencies, environment setup, and service registration.

#### Scenario: Automated installation on a clean machine

- GIVEN a machine with `deno` and `agy` binaries installed
- WHEN the user executes `install.sh`
- THEN the script MUST detect the paths for `deno` and `agy`
- AND it MUST generate an appropriate env file for the user to edit
- AND it MUST copy the example agent configurations to the system agent directory
- AND it MUST install and enable the systemd service template

#### Scenario: Script is idempotent and safe

- GIVEN existing agent configs in `~/.gemini/config/agents/`
- WHEN `install.sh` runs without --force
- THEN it MUST NOT overwrite existing configs (skip-if-exists)
- AND with --force it MUST overwrite

### Requirement: Manual Installation Fallback

The project MUST provide complete documentation for manual installation to support environments without systemd or standard layouts.

#### Scenario: User installs manually

- GIVEN the user's environment does not support `install.sh`
- WHEN the user follows the README manual setup instructions
- THEN they MUST be able to successfully configure the environment variables, agent files, and service startup without the script
