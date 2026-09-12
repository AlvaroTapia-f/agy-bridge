# PR #3 Explicit Read-Only Host Workspace Support - Design

**Status:** Approved architecture after security audit

**Base:** `main` at or after PR #2 merge commit `471c32a77c407ee311aa04b7e465e0c1fce4ca71`

**Selected scope:** Option A, one explicit host workspace per deployment, read-only only

**Deferred:** read-write host workspace support moves to PR #4

## 1. Goal

Add an explicit Docker-only workspace mode that lets `auto-ro-*` inspect one operator-selected host project mounted at `/workspace`, while preserving the secure no-workspace default and all PR #2 OAuth/network boundaries.

PR #3 must not provide host-project write access. In explicit workspace mode, every `auto-rw-*` request is rejected before `agy` is spawned.

## 2. Security objective

PR #3 must establish two separate guarantees:

1. **Host project integrity:** the selected host project is mounted read-only by Docker, so neither the model nor Antigravity can mutate it even if a higher-level permission rule is wrong.
2. **Non-workspace confidentiality:** an `auto-ro-*` worker must not be able to use Antigravity file tools to read `/app`, bridge state, local bridge secrets, keyring storage, Antigravity configuration, or another path outside `/workspace`.

The first guarantee is enforced by the kernel/Docker mount. The second requires explicit Antigravity workspace policy plus live containment canaries on the exact CLI version used by the image.

Prompt instructions are defense-in-depth only. They are never treated as a security boundary.

## 3. Non-goals

PR #3 does not implement:

- read-write host workspace access;
- `auto-rw-*` host project mutation;
- terminal command execution inside the host project;
- per-request workspace selection;
- multiple mounted projects;
- arbitrary host paths in the HTTP API;
- LAN exposure;
- Docker socket access;
- broad host root or user-profile mounts;
- Google OAuth token extraction or private Google API calls;
- wildcard Antigravity grants such as `read_file(*)`, `write_file(*)`, or `command(*)`;
- `--dangerously-skip-permissions`.

## 4. Deployment states

### 4.1 Default deployment

Command:

```text
docker compose up -d
```

Properties:

- no `/workspace` bind mount;
- no `AGY_WORKSPACE_ROOT`;
- no `AGY_WORKSPACE_MODE`;
- existing PR #2 behavior remains unchanged;
- native Linux/systemd behavior remains unchanged;
- `auto-ro-*` and `auto-rw-*` keep their existing non-host-workspace semantics.

### 4.2 Explicit read-only workspace deployment

Command shape:

```text
docker compose -f compose.yaml -f compose.workspace.yaml up -d
```

Operator input:

```text
AGY_WORKSPACE_HOST_PATH=<absolute host project path>
```

Container contract:

```text
AGY_WORKSPACE_ROOT=/workspace
AGY_WORKSPACE_MODE=ro
```

Properties:

- selected host project is bind-mounted to `/workspace` read-only;
- `/app` remains bridge application code, not caller workspace;
- `auto-ro-*` uses `/workspace` as its explicit child working directory;
- `auto-rw-*` returns HTTP 403 before spawning `agy`;
- workspace mode requires `MAX_CONCURRENT=1` to make the per-run policy transaction race-free.

## 5. Compose design

`compose.yaml` remains the secure no-workspace default and should not gain a host bind mount.

Create `compose.workspace.yaml` as an explicit override with these properties:

```yaml
services:
  agy-bridge:
    environment:
      AGY_WORKSPACE_ROOT: /workspace
      AGY_WORKSPACE_MODE: ro
      MAX_CONCURRENT: "1"

    read_only: true

    tmpfs:
      - /tmp
      - /home/agy/.cache

    volumes:
      - type: bind
        source: ${AGY_WORKSPACE_HOST_PATH:?AGY_WORKSPACE_HOST_PATH must be set}
        target: /workspace
        read_only: true
        bind:
          create_host_path: false
```

The existing OAuth/keyring/secrets/state named volumes remain unchanged.

The root filesystem being read-only protects `/app` and other image content from mutation, but it is not treated as protection for separately mounted named volumes.

Only `agy-bridge` receives `/workspace`. Helper services such as `agy-auth`, `print-token`, and `init-secrets` must not receive the host project mount.

## 6. Startup validation

When workspace mode is enabled, `docker/start-bridge.sh` must fail closed unless all of the following are true:

- `AGY_WORKSPACE_ROOT` is exactly `/workspace`;
- `AGY_WORKSPACE_MODE` is exactly `ro`;
- `MAX_CONCURRENT` is exactly `1`;
- `/workspace` exists as a distinct mount;
- `/proc/self/mountinfo` reports the `/workspace` mount as `ro`;
- the host path was supplied through Compose and not inferred from `/app` or the bridge CWD;
- no workspace-local agent file shadows the reserved Docker workspace agent name;
- the installed `agy` version is present in the repository's workspace-verified version allowlist.

The mount check must inspect `/proc/self/mountinfo`; it must not use a destructive write probe against the host project.

## 7. Exact Antigravity version gate

Create:

```text
docker/workspace/verified-agy-versions.txt
```

Workspace mode checks `agy --version` and requires an exact match to one line in this file.

The default no-workspace deployment is not blocked by this workspace-specific gate.

A version may be added only after the full live workspace containment verifier passes on that exact version and final PR SHA. A later image rebuild that installs a new unverified `agy` version must fail workspace startup rather than silently inherit old security claims.

## 8. Docker-specific managed agent

Create a dedicated agent such as:

```text
agents/agy-bridge-worker-ro-v1/agent.md
```

Required frontmatter:

```yaml
---
name: agy-bridge-worker-ro-v1
description: Read-only bridge workspace worker for the explicitly mounted Docker workspace.
tools:
  - view_file
  - list_dir
  - grep_search
  - find_by_name
mainAgent: true
subagent: false
commandExecutionPolicy: off
mcpServers: []
skills: []
plugins: []
---
```

The body must state that `/workspace` is the only caller project root and that `/app`, `$HOME`, bridge state, config, keyring, and secrets are outside the caller workspace.

The agent has only local read/search tools (`view_file`, `list_dir`, `grep_search`, `find_by_name`). It has no web, write, command, MCP, plugin, or skill capability.

The current native/default `worker-ro` agent remains available for no-workspace behavior.

Workspace startup fails if either of these exists:

```text
/workspace/.agents/agents/agy-bridge-worker-ro-v1.md
/workspace/.agents/agents/agy-bridge-worker-ro-v1/agent.md
```

This avoids ambiguous agent discovery/precedence.

## 9. Bridge runtime contract

Add:

```ts
type WorkspaceMode = "ro";

interface WorkspaceConfig {
  root: "/workspace";
  mode: WorkspaceMode;
}

interface AgyExecutionContext {
  cwd?: string;
  workspaceReadOnly?: boolean;
}
```

Rules:

- both workspace variables unset -> `null` workspace config;
- `/workspace` + `ro` -> explicit workspace config;
- any other combination -> startup failure;
- no code may infer workspace from `Deno.cwd()`;
- ordinary model routes never receive workspace execution context;
- `auto-ro-*` uses the Docker-specific reserved agent only when workspace mode is active;
- `auto-rw-*` in workspace mode returns 403 before `agy` invocation.

## 10. Trusted workspace prompt

Only workspace-enabled `auto-ro-*` receives a bridge-owned prompt section before caller messages:

```text
# Bridge workspace contract

The operator explicitly exposed one caller project at /workspace in read-only mode.
Treat /workspace as the caller project root.
Do not treat /app, HOME, the bridge process directory, bridge state, configuration, keyring data, or secrets as caller project files.
Use project filesystem tools only within /workspace.
The workspace is read-only. Never create, modify, delete, or execute project files.
```

No workspace prompt text is added when workspace mode is disabled.

## 11. Workspace child environment sanitization

The existing generic child environment behavior must not be reused for an explicit host-workspace execution.

Create a workspace-specific allowlist. Start with only values required by official `agy` and its authenticated keyring session:

```text
HOME
PATH
LANG
LC_ALL
TERM
DBUS_SESSION_BUS_ADDRESS
XDG_RUNTIME_DIR
```

An entry is copied only if it exists.

The following must never be forwarded to the workspace `agy` child:

```text
AGY_TOKEN
AGY_SECRETS_DIR
KEYRING_PASSWORD_FILE
STATE_DIR
AGY_WORKSPACE_HOST_PATH
```

If live OAuth validation proves another environment variable is required, add that variable explicitly and document why. Do not return to copy-all-minus-a-blocklist behavior for workspace execution.

Default/no-workspace child behavior remains unchanged in PR #3 to minimize unrelated regression risk.

## 12. Transactional Antigravity policy

Antigravity settings are global under `~/.gemini/antigravity-cli/settings.json`, so PR #3 must not leave workspace restrictions enabled for unrelated bridge routes.

Create a local helper:

```text
docker/workspace-policy.sh
```

and add `jq` to the container image for deterministic JSON manipulation.

For each workspace `auto-ro-*` invocation:

1. after acquiring the bridge concurrency slot, apply the RO workspace policy;
2. spawn the official `agy` process;
3. restore the previous managed settings in `finally`, regardless of success, failure, abort, or hard deadline.

Startup also runs `workspace-policy.sh restore-if-needed` so an abrupt bridge/container termination cannot leave a stale policy transaction behind.

The helper manages only these top-level settings:

```text
allowNonWorkspaceAccess
trustedWorkspaces
toolPermission
permissions
```

It backs up both value and presence/absence for every managed key under:

```text
$STATE_DIR/workspace-policy-backup.json
```

RO policy:

```json
{
  "allowNonWorkspaceAccess": false,
  "trustedWorkspaces": ["/workspace"],
  "toolPermission": "strict",
  "permissions": {
    "allow": [
      "read_file(/workspace)"
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

No wildcard permission appears in either allow or deny lists.

The policy helper may inspect settings, but it must never inspect, copy, print, or transform Google OAuth access/refresh tokens or the bridge Bearer token.

## 13. Deno permissions

The main bridge process must not gain direct filesystem access to `/workspace` merely to support the feature.

Do not add:

```text
--allow-read=/workspace
--allow-write=/workspace
--allow-read
--allow-write
```

The bridge may receive `--allow-run` for the exact local workspace-policy helper in addition to the official `agy` binary.

If setting child `cwd=/workspace` unexpectedly requires a Deno filesystem permission, implementation stops for design review rather than broadening permissions automatically.

## 14. Runtime logging

Usage/operational logs may include:

```text
workspace_enabled=true
workspace_mode=ro
workspace_root=/workspace
```

Logs must not include:

- the host-side path;
- bridge Bearer token;
- keyring password;
- OAuth credentials;
- workspace file contents used only for containment probes.

## 15. Deterministic tests

### Default regression

Prove:

- `compose.yaml` has no `/workspace` bind;
- default prompts contain no workspace contract;
- default `auto-ro` and `auto-rw` routing remain unchanged;
- native behavior is unchanged when workspace env is absent.

### Workspace runtime

Prove with fake `agy`:

- `auto-ro-*` selects `agy-bridge-worker-ro-v1`;
- child CWD is `/workspace`;
- child environment does not contain bridge-only secret variables;
- trusted workspace prompt is injected;
- `auto-rw-*` returns 403;
- denied `auto-rw-*` does not spawn fake `agy`;
- invalid workspace mode/root is rejected;
- workspace mode rejects `MAX_CONCURRENT != 1`.

### Compose

Resolve `compose.yaml + compose.workspace.yaml` and prove:

- exactly one `/workspace` bind exists;
- it is read-only;
- `bind.create_host_path` is false in the source declaration;
- root filesystem is read-only;
- tmpfs mounts exist for `/tmp` and `/home/agy/.cache`;
- helper services do not receive `/workspace`;
- host port remains `127.0.0.1:7421`;
- no Docker socket;
- no privileged mode;
- no host networking;
- existing named volumes remain.

### Policy helper

Using temporary settings/state directories, prove:

- absent managed keys remain absent after restore;
- present values are restored exactly;
- unrelated settings remain unchanged;
- RO apply writes the exact expected policy;
- a second apply is rejected rather than overwriting the backup;
- stale backup recovery restores safely;
- failed/corrupt backup causes fail-closed behavior;
- no wildcard filesystem or command rule appears.

### Static security checks

Fail if production workspace changes introduce:

```text
read_file(*)
write_file(*)
command(*)
--dangerously-skip-permissions
--allow-read=/workspace
--allow-write=/workspace
```

## 16. Live Windows + Docker Desktop acceptance

Use a disposable host directory outside the `agy-bridge` repository.

Create a fixture with:

```text
README-fixture.txt
nested/inspect-me.txt
```

Create harmless canaries outside the workspace inside the container/runtime environment:

- `/app` canary;
- bridge-state canary;
- agy-secrets dummy canary;
- keyring-storage dummy canary;
- a bridge-only environment canary that is intentionally omitted from the sanitized child environment.

Never use real OAuth tokens, real bridge tokens, or real keyring secrets as probe values.

The full live verifier must prove:

1. exact installed `agy` version is reported;
2. workspace startup accepts that version only after it is listed as verified;
3. `auto-ro-*` reads both fixture files;
4. host-side hashes/timestamps/content remain unchanged after mutation requests;
5. `auto-rw-*` returns 403;
6. `/app` canary cannot be retrieved through workspace tools;
7. bridge-state canary cannot be retrieved;
8. agy-secrets dummy canary cannot be retrieved;
9. keyring-storage dummy canary cannot be retrieved;
10. path traversal such as `/workspace/../app/...` cannot escape containment;
11. the bridge-only environment canary is not present in the workspace child;
12. OAuth remains usable;
13. Host and Bearer guards remain unchanged;
14. port publication remains loopback-only;
15. OAuth/state survive restart, down/up, recreation, rebuild, and Docker Desktop restart as in PR #2.

Any non-workspace canary disclosure is a merge blocker.

## 17. Supported host claim

PR #3 may advertise explicit host workspace support only for environments that pass the full workspace verifier.

Initial advertised live support is Windows Docker Desktop x86_64 because that is the environment already used for PR #2 acceptance and is the target for the first PR #3 workspace gate.

Other Docker hosts remain unverified until the same workspace containment gates pass there.

## 18. Rollback

Return to the secure default by starting only `compose.yaml`.

Startup recovery restores any stale workspace policy backup before normal bridge launch. No workspace bind is present and no OAuth volume deletion is required.

## 19. Exit criteria

PR #3 may merge only when all of the following are true:

- it descends from the merged final PR #2 result;
- default Compose remains workspace-free;
- host workspace mount is kernel-enforced read-only;
- workspace root is exactly `/workspace`;
- `auto-rw-*` cannot run in workspace mode;
- workspace `agy` child CWD is explicitly `/workspace`;
- workspace child environment is allowlisted and excludes bridge secrets;
- the Docker-specific RO agent has no write, command, MCP, plugin, or skill capability;
- transactional Antigravity policy restores exactly after every request and on stale-startup recovery;
- no wildcard Antigravity permission exists;
- no `--dangerously-skip-permissions` exists;
- no Deno read/write grant to `/workspace` exists;
- all non-workspace canaries remain inaccessible;
- exact `agy` version is in the verified allowlist only after live acceptance passes;
- OAuth/keyring persistence remains unchanged;
- Host/Bearer/loopback boundaries remain unchanged;
- native/default behavior remains unchanged when workspace config is absent;
- full Windows + Docker Desktop verifier passes on the final PR SHA.
