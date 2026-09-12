# PR #3 Explicit Read-Only Host Workspace Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development or superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add one explicit read-only host project workspace for Docker
`auto-ro-*` requests without enabling host writes or weakening PR #2 OAuth,
network, or default behavior.

**Architecture:** Default `compose.yaml` remains workspace-free.
`compose.workspace.yaml` mounts one operator-selected project at
`/workspace:ro`; workspace `auto-ro-*` uses a dedicated read-only agent,
sanitized child environment, explicit `/workspace` CWD, and a transactional
Antigravity containment policy. `auto-rw-*` is rejected with HTTP 403 in
workspace mode. Read-write workspace support is deferred to PR #4.

**Tech Stack:** Deno 2.9.x, TypeScript, Bash, jq, Docker Compose v2, PowerShell,
official Google Antigravity `agy` CLI.

**Spec:**
`docs/superpowers/specs/2026-09-12-explicit-host-workspace-ro-design.md`

## Global Constraints

- Base must contain PR #2 merge commit
  `471c32a77c407ee311aa04b7e465e0c1fce4ca71`.
- One workspace per deployment only.
- Workspace target is exactly `/workspace`.
- PR #3 is read-only host workspace only.
- Workspace mode requires `MAX_CONCURRENT=1`.
- `auto-rw-*` returns 403 in workspace mode before `agy` spawn.
- Default `compose.yaml` remains no-workspace.
- Host path never enters the HTTP API or model prompt.
- No `read_file(*)`, `write_file(*)`, `command(*)`, or
  `--dangerously-skip-permissions`.
- No Deno `--allow-read=/workspace` or `--allow-write=/workspace`.
- No Docker socket, privileged mode, host networking, host root mount, or
  user-profile mount.
- Official `agy` remains the only Google-facing process.
- Existing OAuth/keyring/secrets/state named volumes remain.
- Loopback API remains `127.0.0.1:7421`.
- Default/native behavior remains unchanged when workspace configuration is
  absent.

---

## Commit 1 - `docs: define read-only host workspace boundary`

**Files:**

- Create:
  `docs/superpowers/specs/2026-09-12-explicit-host-workspace-ro-design.md`
- Create: `docs/superpowers/plans/2026-09-12-explicit-host-workspace-ro.md`
- Create: `docs/superpowers/plans/2026-09-12-read-write-host-workspace-pr4.md`

**Interfaces:**

- Consumes: merged PR #2 Docker OAuth architecture and the original PR #3
  planning note.
- Produces: approved RO-only PR #3 contract and preserved RW PR #4 follow-up
  plan.

- [ ] **Step 1: Verify the branch contains PR #2**

Run:

```bash
git merge-base --is-ancestor 471c32a77c407ee311aa04b7e465e0c1fce4ca71 HEAD
```

Expected: exit code `0`.

- [ ] **Step 2: Add the approved PR #3 design and implementation plan**

Copy the reviewed design and this plan into the exact paths above.

- [ ] **Step 4: Add the preserved PR #4 plan**

The PR #4 file must explicitly state that implementation cannot begin until PR
#3 is merged and the RW containment spike passes.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs docs/superpowers/plans
git commit -m "docs: define read-only host workspace boundary"
```

---

## Commit 2 - `feat: add explicit read-only workspace runtime contract`

**Files:**

- Create: `agents/agy-bridge-worker-ro-v1/agent.md`
- Modify: `agy-bridge.ts`
- Modify: `Dockerfile`
- Modify: `docker/start-bridge.sh`
- Modify: `docker/tests/fake-agy.sh`
- Modify: `docker/tests/test-bridge.sh`

**Interfaces:**

- Consumes: `AGY_WORKSPACE_ROOT`, `AGY_WORKSPACE_MODE` from the future Compose
  override.
- Produces:
  - `WorkspaceConfig | null` where valid workspace root is exactly `/workspace`
    and mode is exactly `ro`;
  - workspace `auto-ro-*` execution with CWD `/workspace`;
  - workspace `auto-rw-*` HTTP 403;
  - workspace-specific child environment allowlist;
  - reserved Docker workspace agent `agy-bridge-worker-ro-v1`.

- [ ] **Step 1: Add failing fake-agy observability**

Extend `docker/tests/fake-agy.sh` so tests can capture current working directory
and selected environment names:

```bash
if [[ -n "${FAKE_AGY_CWD_FILE:-}" ]]; then
  pwd -P > "$FAKE_AGY_CWD_FILE"
fi

if [[ -n "${FAKE_AGY_ENV_FILE:-}" ]]; then
  env | sort > "$FAKE_AGY_ENV_FILE"
fi
```

Keep existing argument and stdin capture behavior.

- [ ] **Step 2: Add a stable empty workspace mount target to the image**

While the Dockerfile is still running as root, create:

```text
/workspace
```

owned by UID/GID `10001` with mode `0755`. This directory is only a mount
target; production workspace capability is still disabled unless
`/proc/self/mountinfo` later proves it is an explicit read-only mount.

- [ ] **Step 3: Add failing no-workspace regression assertions**

In `docker/tests/test-bridge.sh`, keep the current launch with no workspace env
and assert:

```text
AUTO profile ro -> --agent worker-ro
AUTO profile rw -> --agent worker-rw
no workspace contract text
no forced /workspace CWD
```

Expected before implementation: existing tests pass.

- [ ] **Step 4: Add a failing workspace launch fixture**

Ensure the image contains an empty owned mount target `/workspace`, then export:

```bash
export AGY_WORKSPACE_ROOT=/workspace
export AGY_WORKSPACE_MODE=ro
export FAKE_AGY_CWD_FILE="$work/agy-cwd.txt"
export FAKE_AGY_ENV_FILE="$work/agy-env.txt"
```

The deterministic bridge test does not treat the empty directory as a production
mount; production startup mount validation is covered separately. The test must
assert:

```text
auto-ro selects agy-bridge-worker-ro-v1
captured CWD equals /workspace
auto-rw returns 403
fake agy invocation count does not increase for denied auto-rw
```

Expected before implementation: FAIL because workspace routing does not exist.

- [ ] **Step 5: Add a failing workspace child-env test**

Set deterministic secret-like variables before the workspace request:

```bash
export AGY_TOKEN=0123456789abcdef0123456789abcdef0123456789abcdef
export AGY_SECRETS_DIR="$work/secrets"
export KEYRING_PASSWORD_FILE="$work/keyring-password"
export STATE_DIR="$work/state"
export AGY_WORKSPACE_HOST_PATH='HOST_PATH_MUST_NOT_REACH_CHILD'
```

After the fake workspace child runs, assert its captured environment does not
contain:

```text
AGY_TOKEN=
AGY_SECRETS_DIR=
KEYRING_PASSWORD_FILE=
STATE_DIR=
AGY_WORKSPACE_HOST_PATH=
```

Also assert `HOME` and `PATH` are present.

Expected before implementation: FAIL because current `childEnv()` copies nearly
everything.

- [ ] **Step 6: Implement workspace config parsing**

Add near bridge configuration:

```ts
type WorkspaceMode = "ro";

interface WorkspaceConfig {
  root: "/workspace";
  mode: WorkspaceMode;
}

function loadWorkspaceConfig(): WorkspaceConfig | null {
  const root = Deno.env.get("AGY_WORKSPACE_ROOT");
  const mode = Deno.env.get("AGY_WORKSPACE_MODE");

  if (!root && !mode) return null;
  if (root !== "/workspace") {
    throw new Error("AGY_WORKSPACE_ROOT must be /workspace");
  }
  if (mode !== "ro") {
    throw new Error("AGY_WORKSPACE_MODE must be ro");
  }
  if (MAX_CONCURRENT !== 1) {
    throw new Error("workspace mode requires MAX_CONCURRENT=1");
  }
  return { root, mode };
}

const WORKSPACE = loadWorkspaceConfig();
```

- [ ] **Step 7: Implement the workspace child-env allowlist**

Keep existing `childEnv()` for non-workspace behavior and add:

```ts
const WORKSPACE_CHILD_ENV_ALLOWLIST = [
  "HOME",
  "PATH",
  "LANG",
  "LC_ALL",
  "TERM",
  "DBUS_SESSION_BUS_ADDRESS",
  "XDG_RUNTIME_DIR",
] as const;

function workspaceChildEnv(): Record<string, string> {
  const source = Deno.env.toObject();
  const env: Record<string, string> = {};
  for (const key of WORKSPACE_CHILD_ENV_ALLOWLIST) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}
```

Do not add any bridge secret variable to this list.

- [ ] **Step 8: Add an execution context to `runAgy()`**

Add:

```ts
interface AgyExecutionContext {
  cwd?: string;
  workspaceReadOnly?: boolean;
}
```

Extend `runAgy()` with an optional final argument:

```ts
execution: AgyExecutionContext = {};
```

When constructing `Deno.Command`, use:

```ts
cwd: execution.cwd,
env: execution.workspaceReadOnly ? workspaceChildEnv() : childEnv(),
```

Do not add Deno read/write permissions for the workspace.

- [ ] **Step 9: Add workspace autonomous routing**

When workspace mode is active:

```ts
if (auto.profile === "rw") {
  return jsonError(
    403,
    "workspace is read-only; read-write host workspace support is not enabled",
  );
}
```

For `auto-ro-*`, choose agent `agy-bridge-worker-ro-v1`, inject the trusted
workspace contract, and pass:

```ts
{
  cwd: WORKSPACE.root,
  workspaceReadOnly: true,
}
```

Default/no-workspace routing keeps `worker-ro` and `worker-rw` exactly as
before.

- [ ] **Step 10: Add the Docker-specific RO agent**

Create `agents/agy-bridge-worker-ro-v1/agent.md` with this frontmatter:

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

The body must define `/workspace` as the sole caller project and forbid treating
`/app`, `$HOME`, bridge state, config, keyring, or secrets as project files.

- [ ] **Step 11: Sync the new managed agent in Docker startup**

Modify the managed-agent copy loop so Docker startup installs:

```text
raw
worker-ro
worker-rw
agy-bridge-worker-ro-v1
```

- [ ] **Step 12: Run deterministic tests**

Run:

```bash
docker compose --profile test run --rm test
deno fmt --check agy-bridge.ts
deno lint
deno task test
```

Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add \
  agents/agy-bridge-worker-ro-v1/agent.md \
  agy-bridge.ts \
  Dockerfile \
  docker/start-bridge.sh \
  docker/tests/fake-agy.sh \
  docker/tests/test-bridge.sh

git commit -m "feat: add explicit read-only workspace runtime contract"
```

---

## Commit 3 - `feat: add read-only workspace compose boundary`

**Files:**

- Create: `compose.workspace.yaml`
- Create: `docker/workspace/verified-agy-versions.txt`
- Create: `docker/tests/test-compose-workspace.ps1`
- Modify: `docker/start-bridge.sh`
- Modify: `docker/tests/run.sh`
- Modify: `docker/tests/check-runtime-permissions.sh`

**Interfaces:**

- Consumes: `AGY_WORKSPACE_HOST_PATH` from the operator.
- Produces: exact `/workspace:ro` mount and fail-closed startup validation.

- [ ] **Step 1: Write the failing Compose test**

Create `docker/tests/test-compose-workspace.ps1` that sets a disposable absolute
path in `$env:TEMP`, assigns it to `AGY_WORKSPACE_HOST_PATH`, and resolves:

```powershell
docker compose -f compose.yaml -f compose.workspace.yaml config --format json
```

Assert:

```text
agy-bridge exists
exactly one /workspace bind exists
/workspace is read-only
AGY_WORKSPACE_ROOT=/workspace
AGY_WORKSPACE_MODE=ro
MAX_CONCURRENT=1
service read_only=true
tmpfs contains /tmp
tmpfs contains /home/agy/.cache
127.0.0.1:7421 remains the only published port
no docker.sock
not privileged
not host network
helper services have no /workspace mount
existing named volumes remain present
```

Expected before implementation: FAIL because `compose.workspace.yaml` does not
exist.

- [ ] **Step 2: Create `compose.workspace.yaml`**

Use:

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

Do not modify base `compose.yaml` to add any host bind.

- [ ] **Step 3: Add workspace mount validation to startup**

When workspace mode is enabled, validate exact root/mode/concurrency and parse
`/proc/self/mountinfo` so an entry whose mountpoint field is `/workspace`
contains the `ro` mount option.

Reject missing mount, `rw`, wrong root, wrong mode, or concurrency other than
`1`.

- [ ] **Step 4: Add workspace-agent collision guard**

Fail startup if either path exists:

```text
/workspace/.agents/agents/agy-bridge-worker-ro-v1.md
/workspace/.agents/agents/agy-bridge-worker-ro-v1/agent.md
```

Do not inspect arbitrary workspace file contents.

- [ ] **Step 5: Add exact version gate**

Create `docker/workspace/verified-agy-versions.txt` initially with comments
explaining that only versions proven by the live verifier may be listed.

Startup workspace mode runs `agy --version`, extracts the semantic version, and
requires an exact non-comment line match.

The default deployment does not use this gate.

During deterministic tests, use a temporary test copy of the version file
containing the fake CLI version rather than weakening production behavior.

- [ ] **Step 6: Extend static runtime-permission checks**

`docker/tests/check-runtime-permissions.sh` must fail if
`docker/start-bridge.sh` contains:

```text
--allow-read=/workspace
--allow-write=/workspace
```

It must also continue rejecting broad `.gemini` read grants.

- [ ] **Step 7: Run tests**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\docker\tests\test-compose-workspace.ps1
```

and:

```bash
docker compose --profile test run --rm test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add \
  compose.workspace.yaml \
  docker/workspace/verified-agy-versions.txt \
  docker/start-bridge.sh \
  docker/tests/test-compose-workspace.ps1 \
  docker/tests/run.sh \
  docker/tests/check-runtime-permissions.sh

git commit -m "feat: add read-only workspace compose boundary"
```

---

## Commit 4 - `feat: apply transactional workspace read policy`

**Files:**

- Create: `docker/workspace-policy.sh`
- Create: `docker/tests/test-workspace-policy.sh`
- Modify: `Dockerfile`
- Modify: `agy-bridge.ts`
- Modify: `docker/start-bridge.sh`
- Modify: `docker/tests/run.sh`

**Interfaces:**

- Consumes: Antigravity `settings.json`, `$STATE_DIR`, and explicit workspace
  execution state.
- Produces: atomic `apply-ro`, `restore`, and `restore-if-needed` operations
  that affect only managed settings and always preserve prior presence/value
  state.

- [ ] **Step 1: Add jq to the image**

Add Debian package `jq` beside the existing runtime packages in `Dockerfile`.

- [ ] **Step 2: Write failing policy-helper tests**

Create temporary settings/state paths and cover these cases:

```text
all managed keys absent
all managed keys present with non-default values
mixed presence
unrelated settings present
second apply while backup exists
corrupt backup
stale backup recovery
```

The test must verify exact restoration of these managed keys:

```text
allowNonWorkspaceAccess
trustedWorkspaces
toolPermission
permissions
```

and exact preservation of unrelated keys.

Expected before implementation: FAIL because helper does not exist.

- [ ] **Step 3: Implement atomic managed-key backup**

`workspace-policy.sh apply-ro` must:

1. refuse to overwrite an existing backup;
2. read settings as `{}` when the file is absent;
3. record for each managed key whether it was present and its exact value;
4. write backup under `$STATE_DIR/workspace-policy-backup.json` using a
   temporary file plus atomic rename;
5. update only managed keys in settings using a temporary file plus atomic
   rename.

- [ ] **Step 4: Apply the exact RO policy**

The helper must set:

```json
{
  "allowNonWorkspaceAccess": false,
  "trustedWorkspaces": ["/workspace"],
  "toolPermission": "request-review",
  "permissions": {
    "allow": ["read_file(/workspace)"],
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

No wildcard rule is permitted. For `agy 1.2.2`, `request-review` is required for
headless workspace reads: `strict` turns `view_file`/`read_file` into an
approval request that headless mode auto-denies. The dedicated read-only agent,
explicit path policy, `allowNonWorkspaceAccess=false`, and Docker RO boundaries
remain the containment controls.

- [ ] **Step 5: Implement restore semantics**

`workspace-policy.sh restore` must restore each managed key to its prior value
when previously present and delete it when previously absent, leave unrelated
keys untouched, then remove the backup only after settings restoration succeeds.

`restore-if-needed` is a no-op with no backup and otherwise performs the same
restoration.

A corrupt backup must fail closed and remain on disk for inspection.

- [ ] **Step 6: Add startup stale-policy recovery**

Before OAuth/model preflight, `docker/start-bridge.sh` runs:

```text
/app/docker/workspace-policy.sh restore-if-needed
```

with the existing config/state mounts available.

- [ ] **Step 7: Permit only the exact helper executable**

Extend the bridge Deno run permission from only `$AGY_BIN` to the exact pair:

```text
$AGY_BIN
/app/docker/workspace-policy.sh
```

Do not grant generic shell or `deno` execution.

- [ ] **Step 8: Wrap workspace `runAgy()` execution transactionally**

After `acquire()` and before workspace child spawn:

```text
workspace-policy.sh apply-ro
```

In the outer `finally`, after the child has reached terminal handling but before
releasing the concurrency slot:

```text
workspace-policy.sh restore
```

If policy apply fails, do not spawn `agy`.

If restore fails, mark the request failed, log the policy failure without secret
content, and keep the backup for startup recovery.

No policy helper is invoked for no-workspace requests.

- [ ] **Step 9: Add lifecycle regression tests**

Extend deterministic tests to cover successful workspace request, child failure,
aborted request, and hard-deadline path, asserting the policy backup is absent
afterward in every path where restoration succeeded.

- [ ] **Step 10: Run tests**

```bash
bash docker/tests/test-workspace-policy.sh
docker compose --profile test run --rm test
deno lint
deno task test
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add \
  Dockerfile \
  agy-bridge.ts \
  docker/start-bridge.sh \
  docker/workspace-policy.sh \
  docker/tests/test-workspace-policy.sh \
  docker/tests/run.sh

git commit -m "feat: apply transactional workspace read policy"
```

---

## Commit 5 - `test: gate live read-only workspace containment`

**Files:**

- Modify: `docker/tests/verify-all.ps1`
- Modify: `docker/tests/check-verify-all-policy.sh`
- Modify: `docker/workspace/verified-agy-versions.txt`

**Interfaces:**

- Consumes: final production image, existing OAuth volumes, disposable host
  workspace fixture.
- Produces: mandatory live proof that host mutation and non-workspace disclosure
  are blocked for the exact installed `agy` version.

- [ ] **Step 1: Add workspace fixture helpers to `verify-all.ps1`**

Use a unique directory under `[System.IO.Path]::GetTempPath()` outside the
repository. Create:

```text
README-fixture.txt
nested/inspect-me.txt
```

Record SHA-256 hashes before workspace tests.

Always remove the fixture in `finally` after the workspace Compose stack is
stopped.

- [ ] **Step 2: Add harmless container-side canaries**

Before workspace requests, create random unique dummy values in these locations
using `docker compose exec` as test setup:

```text
/app/.workspace-app-canary
/home/agy/.local/state/agy-bridge/workspace-state-canary
/home/agy/.local/share/agy-secrets/workspace-secret-canary
/home/agy/.local/share/keyrings/workspace-keyring-canary
```

Do not use a real token, password, or credential as a canary.

Also set a bridge-only environment canary in the workspace Compose test
invocation and assert it is not present in the workspace child environment
through deterministic instrumentation.

- [ ] **Step 3: Start explicit RO workspace deployment**

Set `AGY_WORKSPACE_HOST_PATH` to the fixture and run:

```powershell
docker compose -f compose.yaml -f compose.workspace.yaml up -d --force-recreate agy-bridge
```

Wait for health using the existing verifier helper.

- [ ] **Step 4: Verify exact `agy` version**

Capture:

```powershell
docker compose -f compose.yaml -f compose.workspace.yaml exec -T agy-bridge agy --version
```

The version must be the exact candidate being tested for the final allowlist
entry.

- [ ] **Step 5: Verify workspace reads**

Use the selected live model and call:

```text
auto-ro-<selected model>
```

Ask it to read both fixture files and include unique fixture markers in its
final answer. Fail if markers are absent.

- [ ] **Step 6: Verify host project immutability**

Ask the same route to modify, delete, and create files in `/workspace`.

After the request, recompute host hashes and list directory entries. Require
exact equality with the pre-test state.

- [ ] **Step 7: Verify auto-rw denial**

Call `auto-rw-<selected model>` and require HTTP 403 with no project mutation.

- [ ] **Step 8: Verify non-workspace canary denial**

Make separate `auto-ro-*` requests asking for each dummy canary value by
absolute path and by traversal path where applicable.

Fail if any response contains the unique canary value from:

```text
/app
bridge state
agy-secrets
keyring storage
```

Also request `/workspace/../app/.workspace-app-canary` and require no canary
disclosure.

- [ ] **Step 9: Preserve PR #2 security/persistence gates**

After workspace gates, run existing Host/Bearer checks and persistence
transitions. OAuth, bridge token, bridge state, loopback publication, restart,
down/up, recreation, rebuild, and Docker Desktop restart gates must continue to
pass.

- [ ] **Step 10: Add verifier policy lock**

Extend `docker/tests/check-verify-all-policy.sh` so it fails if the mandatory
workspace gates are removed from `verify-all.ps1`.

- [ ] **Step 11: Run the full verifier with the candidate version staged in the
      allowlist**

Stage the exact installed version in
`docker/workspace/verified-agy-versions.txt`, then run:

```powershell
$HEAD = (git rev-parse HEAD).Trim()
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\docker\tests\verify-all.ps1 `
  -ExpectedHead $HEAD
```

The run is valid only without `-SkipLive` and without `-SkipDockerRestart`.

If any containment canary is disclosed, remove the staged version entry and do
not commit this task.

- [ ] **Step 12: Commit only after full PASS**

```bash
git add \
  docker/tests/verify-all.ps1 \
  docker/tests/check-verify-all-policy.sh \
  docker/workspace/verified-agy-versions.txt

git commit -m "test: gate live read-only workspace containment"
```

---

## Commit 6 - `docs: document read-only host workspace operation`

**Files:**

- Modify: `docs/docker-compose.md`

**Interfaces:**

- Consumes: final verified Compose/runtime behavior.
- Produces: operator instructions that do not imply RW support.

- [ ] **Step 1: Document the RO launch flow**

Include Windows PowerShell:

```powershell
$env:AGY_WORKSPACE_HOST_PATH = 'C:\src\project'

docker compose `
  -f compose.yaml `
  -f compose.workspace.yaml `
  up -d
```

State that the path must point only to the intended project directory and must
not be `C:\`, a user profile, Docker Desktop storage, or another broad path.

- [ ] **Step 2: Document routing behavior**

State:

```text
auto-ro-* -> explicit /workspace read-only project access
auto-rw-* -> HTTP 403 in workspace deployment
ordinary/bare models -> no host workspace capability is implied
```

- [ ] **Step 3: Document version gating**

Explain that an image rebuild can install a newer official `agy`, and workspace
mode intentionally refuses to start until that exact version passes the
repository's live containment verifier and is added to the verified-version
file.

- [ ] **Step 4: Document rollback**

To return to default:

```powershell
docker compose -f compose.yaml -f compose.workspace.yaml down
docker compose up -d
```

Explain that stale managed workspace policy is automatically restored and OAuth
named volumes are retained.

- [ ] **Step 5: Verify every documented Compose command**

Run corresponding `docker compose ... config` commands with a disposable valid
host path and confirm they resolve.

- [ ] **Step 6: Commit**

```bash
git add docs/docker-compose.md
git commit -m "docs: document read-only host workspace operation"
```

---

## Final PR #3 Gate

Run:

```bash
git diff main...HEAD --check
deno fmt --check
deno lint
deno task test
docker compose --profile test run --rm test
```

On Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\docker\tests\test-compose.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\docker\tests\test-compose-workspace.ps1

$HEAD = (git rev-parse HEAD).Trim()
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\docker\tests\verify-all.ps1 `
  -ExpectedHead $HEAD
```

Full acceptance requires all live and Docker-restart gates.

Expected logical history:

```text
docs: define read-only host workspace boundary
feat: add explicit read-only workspace runtime contract
feat: add read-only workspace compose boundary
feat: apply transactional workspace read policy
test: gate live read-only workspace containment
docs: document read-only host workspace operation
```

Do not merge if any non-workspace canary is disclosed, the host fixture changes,
`auto-rw-*` reaches `agy`, or the exact CLI version is not backed by a full live
PASS.
