# PR #4 Read-Write Host Workspace - Preserved Follow-Up Plan

**Status:** Deferred. Do not implement as part of PR #3.

**Dependency:** Implementation must not begin until PR #3 (explicit read-only
host workspace support) is merged and the read-write containment spike described
below passes.

## Goal

Preserve the follow-up scope for explicit read-write host workspace support
without weakening the PR #3 read-only boundary or PR #2
OAuth/network/default-deployment guarantees.

## Preconditions

Before implementation work starts:

1. PR #3 must be merged and its final live Windows + Docker Desktop containment
   verifier must be passing.
2. A dedicated read-write containment spike must demonstrate that the official
   `agy` CLI can be constrained to the one explicitly mounted project while
   preventing access to bridge application code, bridge state, local bridge
   secrets, keyring storage, Antigravity configuration, Docker control surfaces,
   broad host paths, and other non-workspace locations.
3. The spike must use harmless canaries rather than real OAuth tokens, Bearer
   tokens, passwords, or credentials.
4. If the spike cannot prove those boundaries on the exact `agy` version to be
   supported, PR #4 implementation must not begin.

## Preserved Boundary

PR #4 is the place for read-write host workspace behavior. PR #3 remains
read-only only: workspace `auto-rw-*` is rejected with HTTP 403 before `agy` is
spawned.

The PR #4 design must be reviewed separately before production code is written.
It must not silently broaden PR #3 by adding wildcard filesystem/command
permissions, `--dangerously-skip-permissions`, Docker socket access, privileged
mode, host networking, broad host-root/user-profile mounts, private Google API
calls, or OAuth token extraction.

## Next Design Work

After the preconditions pass, create a dedicated PR #4 design/spec and
implementation plan that defines the minimum write-capable agent/tool surface,
mount semantics, Antigravity permission policy, child-environment rules,
rollback/recovery semantics, version gating, deterministic tests, and live
mutation/containment acceptance gates.
