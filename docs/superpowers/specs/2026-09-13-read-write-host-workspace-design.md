# PR #4 Explicit Read-Write Host Workspace Support - Design

**Status:** Draft for review after dedicated RW containment spike PASS

**Base:** Stacked on final PR #3 HEAD
`0cdfe4131b59e2e93791437ffe85dc5b9895589f` until PR #3 is merged. Production
implementation must be re-anchored on the merged PR #3/main state before it
begins.

**Selected scope:** one explicit host workspace per Docker deployment, with a
separate read-write deployment that preserves the PR #3 read-only deployment
unchanged.

**Exact spike candidate:** official Google Antigravity `agy 1.2.2`.

## 1. Decision summary

PR #4 adds a third explicit deployment state rather than broadening the PR #3
override in place:

```text
default
  -> no /workspace mount

RO workspace
  -> compose.workspace.yaml
  -> /workspace kernel read-only
  -> existing PR #3 guarantees unchanged

RW workspace
  -> compose.workspace-rw.yaml
  -> only /workspace host bind is writable
  -> container root filesystem remains read-only
  -> dedicated RW agent and transactional RW Antigravity policy
```

The runtime treats deployment mode as the maximum workspace capability. In an
RW deployment, `auto-ro-*` continues to use the dedicated RO workspace agent
and RO policy; `auto-rw-*` uses the dedicated RW workspace agent and RW policy.
In an RO deployment, `auto-rw-*` remains HTTP 403 before `agy` is spawned.

The initial production RW surface is intentionally smaller than the generic
`worker-rw` surface. It supports workspace reads, search, file creation, and
content replacement. It does not expose shell commands, web tools, MCP, skills,
plugins, or a generic delete capability.

## 2. Dedicated RW containment spike evidence

The required spike passed before this design was written.

The spike used:

- official `agy 1.2.2` from `agy-bridge:local`;
- model `gemini-3.8-flash-high` selected through official `agy models`;
- a disposable Windows host workspace under the system temp directory, outside
  the `agy-bridge` checkout;
- disposable clones of the existing config, keyring, secrets, and bridge-state
  Docker named volumes so no containment probe targeted the live originals;
- harmless unique canaries only;
- a read-only container root filesystem;
- a writable `/workspace` bind;
- no Docker socket, privileged mode, host networking, or broad host bind;
- a sanitized `agy` child environment that omitted a bridge-only environment
  canary.

The mutation gate passed for:

- file creation;
- file content replacement;
- nested-path creation;
- file deletion.

Deletion in the spike was deliberately enabled only by one exact command rule
for the disposable fixture:

```text
command(regex:^rm /workspace/delete-me\.txt$)
```

The spike then proved that a chained command outside that exact rule did not
execute. This proves that tightly scoped command containment is possible for the
tested fixture; it does not justify a reusable production shell surface.

The containment gate passed for read and write attempts against:

- `/app`;
- bridge state;
- agy-secrets storage;
- keyring storage;
- Antigravity settings/configuration;
- absolute non-workspace paths;
- `/workspace/../...` traversal;
- a workspace symlink targeting writable bridge state;
- bridge-only environment data;
- Docker control surfaces.

The spike result was:

```text
exactAgyVersion=1.2.2
mutation=PASS
containment=PASS
rootfsReadOnly=true
dockerSocketAbsent=true
privilegedFalse=true
hostNetworkFalse=true
broadHostMountsAbsent=true
envCanaryOmitted=true
verdict=PASS
```

This spike is feasibility evidence only. The final implementation must repeat
the full live mutation and containment acceptance on the final candidate SHA.

## 3. Security objective

PR #4 must allow the operator-selected host project at `/workspace` to be
mutated by an explicit `auto-rw-*` request without making any other host or
container location part of the caller project.

The design must preserve two independent properties:

1. **Workspace write scope:** only the explicitly mounted `/workspace` host bind
   is writable as caller project data.
2. **Non-workspace containment:** workspace `agy` tools cannot disclose or
   mutate `/app`, bridge state, secrets, keyring storage, Antigravity config,
   Docker control surfaces, or another host path.

The writable host bind is an explicit operator capability grant. It is not a
reason to make the container root filesystem writable or to broaden process,
environment, network, or Docker privileges.

Prompt text is defense in depth only. The security claims come from Docker
mounts/rootfs, the dedicated agent surface, exact Antigravity policy, sanitized
child environment, startup validation, and live containment evidence.

## 4. Non-goals

PR #4 does not add:

- per-request host path selection;
- multiple host workspaces;
- a writable container root filesystem;
- direct bridge/Deno filesystem access to `/workspace`;
- generic shell command execution in the workspace;
- generic file deletion in the initial RW agent;
- web tools in the dedicated RW agent;
- MCP, plugins, or skills in the dedicated RW agent;
- Docker socket access;
- privileged mode;
- host networking;
- host-root or user-profile mounts;
- wildcard `read_file(*)`, `write_file(*)`, or `command(*)` grants;
- `--dangerously-skip-permissions`;
- OAuth token extraction or private Google API calls;
- weakening or mode-switching the existing PR #3 RO Compose override.

A later command/delete capability requires a separate reviewed design plus live
proof for arbitrary target confinement. The one exact deletion command from the
spike is not a production interface.

## 5. Deployment states

### 5.1 Default deployment

Command:

```text
docker compose up -d
```

Properties remain unchanged:

- no `/workspace` bind;
- no workspace environment variables;
- existing native/default routing and agents remain unchanged;
- existing Host, Bearer, loopback, OAuth, keyring, secrets, and state behavior
  remains unchanged.

### 5.2 Explicit RO workspace deployment

Command:

```text
docker compose -f compose.yaml -f compose.workspace.yaml up -d
```

PR #3 remains the source of truth:

- `/workspace` is a distinct read-only bind;
- `AGY_WORKSPACE_MODE=ro`;
- `auto-ro-*` uses `agy-bridge-worker-ro-v1` and `apply-ro`;
- `auto-rw-*` returns HTTP 403 before spawn;
- the PR #3 exact-version gate and RO containment claims remain unchanged.

### 5.3 Explicit RW workspace deployment

Command:

```text
docker compose -f compose.yaml -f compose.workspace-rw.yaml up -d
```

Operator input remains:

```text
AGY_WORKSPACE_HOST_PATH=<absolute host project path>
```

Container contract:

```text
AGY_WORKSPACE_ROOT=/workspace
AGY_WORKSPACE_MODE=rw
MAX_CONCURRENT=1
```

Request matrix:

```text
RW deployment + auto-ro-* -> RO workspace agent + apply-ro
RW deployment + auto-rw-* -> RW workspace agent + apply-rw
```

An `auto-ro-*` request in an RW deployment is logically read-only through the
RO agent/policy, but it does not have the kernel-level host-integrity guarantee
of the PR #3 RO deployment because the deployment itself exposes a writable
bind. Operators requiring the kernel RO guarantee use `compose.workspace.yaml`.

## 6. RW Compose and mount semantics

Add a dedicated override:

```text
compose.workspace-rw.yaml
```

It must configure only `agy-bridge` with:

```yaml
services:
  agy-bridge:
    environment:
      AGY_WORKSPACE_ROOT: /workspace
      AGY_WORKSPACE_MODE: rw
      MAX_CONCURRENT: "1"

    read_only: true

    tmpfs:
      - /tmp
      - /home/agy/.cache

    volumes:
      - type: bind
        source: ${AGY_WORKSPACE_HOST_PATH:?AGY_WORKSPACE_HOST_PATH must be set}
        target: /workspace
        read_only: false
        bind:
          create_host_path: false
```

The explicit `read_only: false` documents the intended writable bind; the
container root filesystem remains `read_only: true`.

The RW deployment must preserve:

- `/app` on the read-only container root filesystem;
- the existing OAuth/keyring/secrets/state named volumes with unchanged mount
  destinations;
- no `/workspace` mount on `agy-auth`, `print-token`, `init-secrets`, or test
  helper services unless a deterministic test explicitly supplies its own
  disposable fixture;
- loopback-only port publication;
- no Docker socket, privileged mode, or host networking.

`compose.workspace.yaml` remains RO-only. It must not gain an environment-driven
RO/RW switch.

## 7. Startup validation

Workspace startup remains fail-closed.

Common validation for both workspace modes:

- `AGY_WORKSPACE_ROOT` is exactly `/workspace`;
- `AGY_WORKSPACE_MODE` is exactly `ro` or `rw`;
- `MAX_CONCURRENT` is exactly `1`;
- `/workspace` exists as a distinct mount;
- the container root mount is read-only;
- the relevant reserved managed-agent name is not shadowed by a workspace-local
  agent file;
- the exact installed `agy` semantic version can be determined;
- the installed version is present in the mode-specific verified-version file.

RO-specific validation remains:

- `/proc/self/mountinfo` reports `/workspace` as `ro`.

RW-specific validation adds:

- `/proc/self/mountinfo` reports `/workspace` as `rw`;
- RW deployment rejects an RO mount rather than silently degrading capability;
- both reserved workspace agent names are collision-checked because RW
  deployment can service both `auto-ro-*` and `auto-rw-*`.

Validation must inspect mount metadata. It must not use a destructive startup
write probe against the host project.

## 8. Exact `agy` RW version attestation

RO and RW verification are separate claims.

Keep the existing PR #3 file unchanged for RO:

```text
docker/workspace/verified-agy-versions.txt
```

Add a distinct RW attestation file:

```text
docker/workspace/verified-rw-agy-versions.txt
```

RW startup requires an exact semantic-version match in the RW file. A version
passing RO verification does not imply RW verification.

The initial candidate is `1.2.2` because the dedicated containment spike passed
on that exact official binary. The candidate is not merge evidence by itself.
The branch is merge-ready only after the full RW live verifier passes on the
final candidate SHA with that same version present.

If the live verifier fails, the SHA/version combination is not verified. Fixes
produce a new candidate SHA and the full live gate must run again. After a full
live PASS, no code, docs, allowlist, or commit changes may occur before merge.

## 9. Workspace runtime interface

Generalize the existing deployment type:

```ts
type WorkspaceMode = "ro" | "rw";

interface WorkspaceConfig {
  root: "/workspace";
  mode: WorkspaceMode;
}
```

Do not add parallel state such as `workspaceReadWrite`.

`WorkspaceConfig.mode` is the deployment's maximum workspace capability. Keep
that value separate from the access selected for one request so an RW deployment
can deliberately downgrade an `auto-ro-*` request to RO policy without
pretending the underlying mount is read-only.

Replace the boolean-only execution interface with one explicit per-request
workspace value:

```ts
type WorkspaceAccess = "none" | WorkspaceMode;

interface WorkspaceExecution {
  root: "/workspace";
  access: WorkspaceAccess;
}

interface AgyExecutionContext {
  workspace?: WorkspaceExecution;
}
```

`runAgy()` derives all workspace-specific behavior from this value:

- child CWD (`ro` / `rw` only; `none` does not use `/workspace` as CWD);
- sanitized child environment;
- policy action;
- child termination/restore ordering.

Request routing resolves a per-request execution access from deployment mode:

```text
no workspace deployment:
  bare    -> no WorkspaceExecution
  auto-ro -> existing worker-ro
  auto-rw -> existing worker-rw

RO deployment:
  bare    -> workspace { root: /workspace, access: none }
  auto-ro -> workspace { root: /workspace, access: ro }
  auto-rw -> 403 before spawn

RW deployment (deployment config remains mode=rw):
  bare    -> workspace { root: /workspace, access: none }
  auto-ro -> execution workspace { root: /workspace, access: ro }
  auto-rw -> execution workspace { root: /workspace, access: rw }
```

Every `agy` child spawned inside an RO/RW workspace deployment therefore has
explicit request-level workspace access. Bare routes remain available, but
`access=none` gives them no `/workspace` CWD, uses the sanitized workspace child
environment, and applies a transactional deny-workspace policy. Bare routes do
not receive the bridge-owned workspace contract prompt. Routing is the only
place that converts deployment capability plus request profile into
`WorkspaceExecution`; callers must not construct ad-hoc CWD/access combinations.

This keeps the execution seam small: one explicit value carries the invariants
instead of separate CWD/mode booleans that can form illegal combinations, while
keeping deployment capability distinct from request access.

## 10. Dedicated RW managed agent

Add:

```text
agents/agy-bridge-worker-rw-v1/agent.md
```

Required frontmatter:

```yaml
---
name: agy-bridge-worker-rw-v1
description: Read-write bridge workspace worker for the explicitly mounted Docker workspace.
tools:
  - view_file
  - list_dir
  - grep_search
  - find_by_name
  - write_to_file
  - replace_file_content
  - multi_replace_file_content
mainAgent: true
subagent: false
commandExecutionPolicy: off
mcpServers: []
skills: []
plugins: []
---
```

The agent body defines `/workspace` as the sole caller project root and permits
file creation/replacement only there. It states that `/app`, `$HOME`, bridge
state, Antigravity config, keyring storage, and secrets are outside the caller
workspace.

The agent has no:

- `run_command`;
- web/search URL tools;
- MCP servers;
- plugins;
- skills.

The generic `worker-rw` agent is not reused for explicit host workspace mode.

RW startup fails if the workspace contains either reserved path:

```text
/workspace/.agents/agents/agy-bridge-worker-rw-v1.md
/workspace/.agents/agents/agy-bridge-worker-rw-v1/agent.md
```

## 11. Trusted workspace prompt

Workspace-enabled `auto-rw-*` receives a bridge-owned prompt section before
caller messages:

```text
# Bridge workspace contract

The operator explicitly exposed one caller project at /workspace in read-write mode.
Treat /workspace as the only caller project root.
Do not treat /app, HOME, the bridge process directory, bridge state, configuration, keyring data, or secrets as caller project files.
You may read, create, and replace project file contents only within /workspace.
This agent has no shell-command capability and no generic file-delete capability.
```

The existing RO contract remains unchanged for `auto-ro-*` workspace requests.

## 12. Antigravity RW permission policy

Generalize `docker/workspace-policy.sh` to support:

```text
apply-none
apply-ro
apply-rw
restore
restore-if-needed
```

The backup schema and managed top-level keys remain the PR #3 source of truth:

```text
allowNonWorkspaceAccess
trustedWorkspaces
toolPermission
permissions
```

Bare routes in either workspace deployment use `apply-none`:

```json
{
  "allowNonWorkspaceAccess": false,
  "trustedWorkspaces": [],
  "toolPermission": "request-review",
  "permissions": {
    "allow": [],
    "deny": [
      "read_file(/workspace)",
      "write_file(/workspace)",
      "read_file(/app)",
      "write_file(/app)",
      "read_file(/home/agy/.gemini)",
      "write_file(/home/agy/.gemini)",
      "read_file(/home/agy/.local/share/agy-secrets)",
      "write_file(/home/agy/.local/share/agy-secrets)",
      "read_file(/home/agy/.local/share/keyrings)",
      "write_file(/home/agy/.local/share/keyrings)",
      "read_file(/home/agy/.local/state/agy-bridge)",
      "write_file(/home/agy/.local/state/agy-bridge)"
    ]
  }
}
```

`apply-none` uses the same backup schema, nested-transaction guard, atomic
settings write, restore ordering, corrupt-backup handling, and startup recovery
as RO/RW policy transactions.

RW policy for exact `agy 1.2.2`:

```json
{
  "allowNonWorkspaceAccess": false,
  "trustedWorkspaces": ["/workspace"],
  "toolPermission": "request-review",
  "permissions": {
    "allow": [
      "read_file(/workspace)",
      "write_file(/workspace)"
    ],
    "deny": [
      "read_file(/app)",
      "write_file(/app)",
      "read_file(/home/agy/.gemini)",
      "write_file(/home/agy/.gemini)",
      "read_file(/home/agy/.local/share/agy-secrets)",
      "write_file(/home/agy/.local/share/agy-secrets)",
      "read_file(/home/agy/.local/share/keyrings)",
      "write_file(/home/agy/.local/share/keyrings)",
      "read_file(/home/agy/.local/state/agy-bridge)",
      "write_file(/home/agy/.local/state/agy-bridge)"
    ]
  }
}
```

The spike established that scoped workspace write rules operate headlessly on
the exact supported version while non-workspace canaries remain contained.

No command permission is present in production RW policy. The agent also has
command execution disabled, so command containment does not depend on a
negative wildcard rule.

No wildcard filesystem or command permission appears in allow, ask, or deny
lists.

## 13. Transactional policy invariant

Preserve one global policy transaction at a time:

```text
acquire concurrency slot
-> choose apply-ro or apply-rw for this request
-> apply workspace policy
-> spawn official agy
-> wait for child terminal state
-> restore policy in finally
-> release concurrency slot
```

`MAX_CONCURRENT=1` remains mandatory while Antigravity settings are global.

`apply-ro` and `apply-rw` share one backup location and one nested-transaction
guard. A second apply cannot overwrite an existing backup.

Restore must preserve both value and presence/absence for every managed key and
leave unrelated settings unchanged.

Startup runs `restore-if-needed` before normal bridge launch so stale state from
an abrupt prior request is recovered before a new policy transaction begins.

## 14. Abort, deadline, and kill behavior

The PR #3 lifecycle ordering remains mandatory for both workspace access modes.

On request abort or hard deadline:

1. signal the `agy` child;
2. escalate SIGTERM to SIGKILL if required;
3. wait for child terminal status;
4. restore the workspace policy;
5. release the concurrency slot.

Policy restore must not race a still-running workspace child. This applies to:

- success;
- natural child failure;
- client abort;
- hard deadline;
- SIGTERM/SIGKILL escalation;
- stale startup recovery.

## 15. Workspace child environment

Reuse the PR #3 allowlist exactly unless live validation demonstrates a new
requirement:

```text
HOME
PATH
LANG
LC_ALL
TERM
DBUS_SESSION_BUS_ADDRESS
XDG_RUNTIME_DIR
```

Never forward bridge-only values including:

```text
AGY_TOKEN
AGY_SECRETS_DIR
KEYRING_PASSWORD_FILE
STATE_DIR
AGY_WORKSPACE_HOST_PATH
AGY_WORKSPACE_ROOT
AGY_WORKSPACE_MODE
```

The dedicated spike confirmed that a bridge-only environment canary was absent
from the official `agy` child under this allowlist shape.

Do not regress to copy-all-minus-blocklist behavior.

## 16. Deno permissions

The bridge process does not gain direct filesystem access to `/workspace` for
RW support.

Do not add:

```text
--allow-read=/workspace
--allow-write=/workspace
--allow-read
--allow-write
```

The existing exact `--allow-run` surface for official `agy` and the local
workspace-policy helper is sufficient. RW policy selection does not require a
new executable.

If implementation unexpectedly requires Deno workspace read/write permission,
stop for design review instead of broadening permissions.

## 17. Deterministic test design

All deterministic Docker tests remain reachable through:

```text
/app/docker/tests/run.sh
```

PR #4 must not create a parallel deterministic suite that bypasses this entry
point.

### 17.1 Runtime matrix

Prove:

- both workspace variables unset -> no workspace config;
- `/workspace` + `ro` -> valid RO deployment config;
- `/workspace` + `rw` -> valid RW deployment config;
- every mismatched/partial combination fails closed;
- workspace mode requires `MAX_CONCURRENT=1`;
- RO deployment `auto-rw-*` returns 403 before spawn;
- RW deployment `auto-ro-*` selects the RO workspace agent and `apply-ro`;
- RW deployment `auto-rw-*` selects `agy-bridge-worker-rw-v1` and `apply-rw`;
- workspace child CWD is `/workspace`;
- workspace child environment uses the allowlist;
- bridge-only variables are absent;
- default/no-workspace agents and routing remain unchanged.

### 17.2 Policy transaction

Using temporary settings/state directories, prove:

- `apply-rw` writes the exact policy from this design;
- `apply-ro` remains byte-for-byte equivalent to PR #3 semantics;
- success/failure/abort/deadline restore exactly;
- stale recovery restores exactly;
- absent managed keys return to absent;
- present managed values return exactly;
- unrelated settings remain unchanged;
- a second apply cannot overwrite an existing backup;
- corrupt backup fails closed and remains available for diagnosis;
- no wildcard filesystem/command permission exists;
- no command permission exists in RW policy.

### 17.3 RW Compose

Resolve `compose.yaml + compose.workspace-rw.yaml` and prove:

- exactly one `/workspace` bind exists;
- the bind is writable;
- `bind.create_host_path` is false in the source declaration;
- container root filesystem remains read-only;
- required tmpfs mounts remain;
- helper services do not receive `/workspace`;
- existing named volumes remain unchanged;
- host port remains loopback-only;
- no Docker socket;
- no privileged mode;
- no host networking.

### 17.4 Startup validation

Prove:

- RW mode rejects a missing/non-distinct workspace mount;
- RW mode rejects an RO workspace mount;
- RW mode rejects a writable container root filesystem;
- RW mode rejects reserved agent collisions;
- RW mode rejects an unverified exact `agy` version;
- RO startup behavior remains unchanged.

### 17.5 Agent/static security

Prove the RW managed agent contains only the approved file tools and has command
execution off.

Continue rejecting production changes containing:

```text
read_file(*)
write_file(*)
command(*)
--dangerously-skip-permissions
--allow-read=/workspace
--allow-write=/workspace
```

Also reject adding `run_command` to the dedicated RW workspace agent or adding a
`command(...)` rule to its production policy without a new reviewed design.

Do not add global/legacy `deno fmt --check` against old files to this work.

## 18. Live RW mutation acceptance

Use a disposable host project outside the repository with at least:

```text
workspace/
  README-fixture.txt
  nested/inspect-me.txt
```

On the final candidate SHA, official `agy` in RW deployment must prove:

1. exact installed version equals the staged RW candidate version;
2. create a new file under `/workspace`;
3. replace contents of an existing file under `/workspace`;
4. create/modify a nested path under `/workspace`;
5. host-side content reflects the intended mutations;
6. a request to delete a file cannot obtain shell/command capability in the v1
   production agent and does not delete the file.

Item 6 makes the initial capability boundary explicit. Generic deletion is not
silently obtained by falling back to a shell.

## 19. Live RW containment acceptance

Create harmless unique canaries for:

- `/app`;
- bridge state;
- agy-secrets storage;
- keyring storage;
- Antigravity config/settings;
- a bridge-only environment value.

Use disposable auth/config/state copies for destructive containment probes when
possible. Never use real credential values as canaries and never print or
transform OAuth tokens, Bearer tokens, passwords, or keyring secrets.

The live verifier must prove:

1. `/app` canary cannot be read through workspace tools;
2. `/app` cannot be mutated;
3. bridge-state canary cannot be read or mutated;
4. agy-secrets canary cannot be read or mutated;
5. keyring canary cannot be read or mutated;
6. Antigravity config canary cannot be read or mutated by model file tools;
7. absolute non-workspace paths cannot escape;
8. `/workspace/../...` traversal cannot escape;
9. a workspace symlink targeting writable non-workspace storage cannot read or
   mutate its target;
10. the bridge-only environment canary is absent from the workspace `agy`
    child;
11. the container root filesystem is read-only;
12. only `/workspace` is a writable host bind;
13. no broad host path is mounted;
14. Docker socket is absent;
15. privileged mode is false;
16. host networking is absent;
17. the dedicated RW agent has no command execution surface;
18. Host/Bearer guards remain unchanged;
19. port publication remains loopback-only;
20. OAuth/keyring/state persistence remains unchanged across the existing
    restart/recreate/rebuild transitions.

Any non-workspace disclosure or mutation is a merge blocker.

## 20. Rollback

Return to the secure default with only:

```text
docker compose up -d
```

or return to kernel-enforced RO workspace mode with:

```text
docker compose -f compose.yaml -f compose.workspace.yaml up -d
```

Startup recovery restores any stale workspace policy backup before normal
bridge launch. Rollback does not delete OAuth, keyring, secrets, or state named
volumes.

## 21. Implementation sequencing gate

Production implementation must not begin until all of these are true:

1. PR #3 final result is merged into `origin/main`;
2. this PR #4 design is reviewed and approved;
3. the PR #4 branch is re-anchored on the merged PR #3/main state if necessary;
4. a detailed Superpowers TDD implementation plan is written from this approved
   design.

The containment spike PASS permits design work. It does not waive the PR #3
merge dependency.

## 22. Final exit criteria

PR #4 may merge only when:

- PR #3 is merged and all PR #3 RO guarantees remain intact;
- default Compose remains workspace-free;
- RO Compose remains kernel read-only and unchanged in semantics;
- RW uses a separate explicit Compose override;
- only `/workspace` is the writable host bind in RW mode;
- container root filesystem remains read-only;
- RW startup validates root, mode, concurrency, mount mode, rootfs mode, agent
  collision, and exact RW-verified `agy` version;
- `auto-rw-*` in RW deployment uses the dedicated RW file-only agent;
- the dedicated RW agent has no command/web/MCP/plugin/skill capability;
- workspace child environment is allowlisted;
- Deno has no direct read/write permission to `/workspace`;
- transactional `apply-ro`/`apply-rw` restore ordering holds on every terminal
  path;
- deterministic PR #4 tests run through `/app/docker/tests/run.sh`;
- all non-live verification gates pass;
- the working tree is clean and the final candidate SHA is frozen;
- the full verifier runs with no `-SkipLive` and no `-SkipDockerRestart`;
- full live verification includes default regression, PR #3 RO containment, PR
  #4 RW mutation, and PR #4 RW containment;
- the exact `agy` version is accepted as RW-verified only by that passing final
  candidate;
- no file or commit changes occur after the full live PASS.
