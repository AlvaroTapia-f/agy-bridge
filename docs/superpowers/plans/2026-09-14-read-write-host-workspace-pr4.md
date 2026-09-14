# PR #4 Read-Write Host Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit, file-only read-write access to one operator-selected Docker host workspace for `auto-rw-*` requests while preserving PR3 read-only behavior and every existing OAuth/network/containment boundary.

**Architecture:** Keep default, RO workspace, and RW workspace deployments explicit and separate. RW uses a dedicated writable `/workspace` bind, read-only container rootfs, dedicated file-only RW agent, sanitized child environment, and transactional `apply-rw` Antigravity policy; `auto-ro-*` in an RW deployment still uses RO agent/policy. The full verifier retains PR3 RO acceptance and adds RW mutation plus read/write containment on official `agy 1.2.2`.

**Tech Stack:** Deno 2.9.x, TypeScript, Bash, jq, Docker Compose v2, PowerShell, Docker Desktop, official Google Antigravity `agy` CLI 1.2.2.

**Spec:** `docs/superpowers/specs/2026-09-13-read-write-host-workspace-design.md`

**Preserved precursor:** `docs/superpowers/plans/2026-09-12-read-write-host-workspace-pr4.md`

## 2026-09-14 Execution Baseline Update

The original plan treated `0cdfe4131b59e2e93791437ffe85dc5b9895589f` as the final PR3 dependency. That identity is historical only and MUST NOT be used as the active PR4 gate.

Fresh Task 0 verification established:

```text
PR3_MERGE_MODE = merge
FINAL_MERGED_PR3_SHA = 832d87d32bbc08ed1cb8ef105d41a7c4f27c4a63
PR3_MAIN_INTEGRATION_SHA = 06567660cb765285cf68f28637169c79ddd1aabc
```

`origin/main` integration commit `06567660cb765285cf68f28637169c79ddd1aabc` has parents `f5ae309fd1cfe11653753d9b62eb7da19abac767` and `832d87d32bbc08ed1cb8ef105d41a7c4f27c4a63`, so the final PR3 branch head is directly contained in `main`. Task 0 and Task 7 MUST validate this current merged PR3 identity, not `0cdfe413...`.

## Global Constraints

- Production implementation MUST NOT begin until current final merged PR3 SHA `832d87d32bbc08ed1cb8ef105d41a7c4f27c4a63` is contained in `origin/main`.
- Work on `impl/pr4-read-write-host-workspace`; before implementation, synchronize it with the merged PR3/main result using Task 0.
- One explicit host workspace per deployment; container path is exactly `/workspace`.
- Default `compose.yaml` remains workspace-free.
- `compose.workspace.yaml` remains RO-only and physically mounts `/workspace` read-only.
- Add a separate `compose.workspace-rw.yaml`; only its `/workspace` host bind is writable.
- Container root filesystem remains read-only in both workspace deployments.
- Workspace modes require `MAX_CONCURRENT=1` while Antigravity settings are global.
- RW v1 is file-only: `view_file`, `list_dir`, `grep_search`, `find_by_name`, `write_to_file`, `replace_file_content`, `multi_replace_file_content`.
- RW v1 has no `run_command`, web tools, MCP, plugins, skills, or generic delete capability.
- No `read_file(*)`, `write_file(*)`, `command(*)`, or any other wildcard Antigravity permission.
- No `--dangerously-skip-permissions`.
- No Deno `--allow-read=/workspace`, `--allow-write=/workspace`, broad `--allow-read`, or broad `--allow-write`.
- Workspace child environment stays allowlisted to `HOME`, `PATH`, `LANG`, `LC_ALL`, `TERM`, `DBUS_SESSION_BUS_ADDRESS`, `XDG_RUNTIME_DIR` when present.
- Never forward `AGY_TOKEN`, `AGY_SECRETS_DIR`, `KEYRING_PASSWORD_FILE`, `STATE_DIR`, `AGY_WORKSPACE_HOST_PATH`, `AGY_WORKSPACE_ROOT`, or `AGY_WORKSPACE_MODE` to workspace `agy` children.
- No Docker socket, privileged mode, host networking, broad host-root/user-profile mount, OAuth token extraction, or private Google API call.
- Existing OAuth/keyring/secrets/state named volumes and loopback publication remain unchanged.
- Do not run global/legacy `deno fmt --check`; do not mass-format or normalize EOLs in legacy files such as `agy-bridge.ts`.
- Deterministic Docker verification must execute `/app/docker/tests/run.sh`; a bare Compose test service command is not the canonical suite.
- Run live acceptance only after all non-live gates pass, the tree is clean, and the final candidate SHA is frozen.
- Full live acceptance uses `docker/tests/verify-all.ps1` without `-SkipLive` and without `-SkipDockerRestart`.
- If full live verification passes, do not edit or commit anything afterward.

## File Map

**Create**

- `agents/agy-bridge-worker-rw-v1/agent.md` — dedicated file-only RW workspace agent.
- `compose.workspace-rw.yaml` — explicit RW Docker Compose override.
- `docker/workspace/verified-rw-agy-versions.txt` — exact RW verification allowlist, separate from RO.
- `docker/tests/test-compose-workspace-rw.ps1` — deterministic RW Compose boundary test.

**Modify**

- `agy-bridge.ts` — workspace mode model, per-request access, routing, prompt, child execution, policy selection.
- `Dockerfile` — normalize the RW allowlist file consistently with the RO allowlist.
- `.dockerignore` — closed-positive build-context entry for `compose.workspace-rw.yaml` if the current allowlist requires it.
- `docker/start-bridge.sh` — RW startup validation, rootfs/mount-mode validation, RW version gate, managed-agent collision/sync.
- `docker/workspace-policy.sh` — add exact `apply-rw` while preserving existing backup/restore behavior.
- `docker/tests/test-workspace-policy.sh` — exact RW policy and restore regression tests.
- `docker/tests/test-bridge.sh` — RW routing, child env, prompt, policy lifecycle and abort/deadline regressions.
- `docker/tests/check-workspace-security-patterns.sh` — extend production surface and reject RW command capability.
- `docker/tests/check-dockerignore-policy.sh` — protect the new closed-positive Compose entry.
- `docker/tests/test-build-context.ps1` — assert new RW runtime controls are present and excluded canaries remain absent.
- `docker/tests/check-verify-all-policy.sh` — lock RW Compose/live gates and canonical deterministic-suite invocation.
- `docker/tests/verify-all.ps1` — preserve RO acceptance and add authoritative RW mutation/containment.
- `docs/docker-compose.md` — explicit RW operation, capability limits, version gate and rollback.

---

## Task 0: Re-verify and Synchronize the PR4 Baseline

**Files:** none.

**Interfaces:**

- Consumes: current final merged PR3 SHA `832d87d32bbc08ed1cb8ef105d41a7c4f27c4a63`, current PR4 branch, `origin/main`.
- Produces: clean PR4 branch containing merged PR3/main before any production edit.

- [ ] **Step 1: Fetch and verify state**

Run:

```powershell
git fetch origin main
git switch impl/pr4-read-write-host-workspace
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
git merge-base HEAD origin/main
git log --oneline --decorate -10
```

Expected: working tree clean. Record all SHAs before mutation.

- [ ] **Step 2: Require exact PR3 containment in `origin/main`**

Run:

```powershell
$FINAL_MERGED_PR3_SHA = '832d87d32bbc08ed1cb8ef105d41a7c4f27c4a63'
git merge-base --is-ancestor $FINAL_MERGED_PR3_SHA origin/main
if ($LASTEXITCODE -ne 0) { throw 'STOP PR4: current final merged PR3 SHA is not contained in origin/main' }
```

Expected: exit `0`.

If this fails, STOP. Do not implement production RW behavior even if GitHub reports a squash/rebase-equivalent PR3 merge; reconcile that topology in a separate reviewed operation first.

- [ ] **Step 3: Synchronize merged main into PR4 without rewriting user work**

Run:

```powershell
git merge --no-edit origin/main
```

Expected: clean merge. If conflicts occur, STOP and resolve them as a separate reviewed merge-conflict task; do not guess through security-sensitive conflicts.

- [ ] **Step 4: Re-verify design-only delta before implementation**

Run:

```powershell
git status --short --branch
git log --oneline --decorate -10
git diff --name-status origin/main...HEAD
```

Expected before production edits: PR4-specific delta is the approved design/spec plus this planning artifact and the synchronization merge topology; no accidental production RW changes already exist.

---

## Task 1: Add the Transactional RW Antigravity Policy

**Files:**

- Modify: `docker/workspace-policy.sh`
- Modify: `docker/tests/test-workspace-policy.sh`

**Interfaces:**

- Consumes: existing `apply-ro`, `restore`, `restore-if-needed`, `$STATE_DIR/workspace-policy-backup.json` schema.
- Produces: `workspace-policy.sh apply-rw` with the same transaction/restore invariants as RO.

- [ ] **Step 1: Add a failing exact-policy test for `apply-rw`**

Extend `docker/tests/test-workspace-policy.sh` with a fresh temp HOME/STATE fixture. After:

```bash
/app/docker/workspace-policy.sh apply-rw
```

assert `settings.json` equals the following managed state while preserving unrelated keys:

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

Also assert no allow/deny item contains `*` and no permission begins with `command(`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
docker compose --profile test build test
docker compose --profile test run --rm test bash -lc 'bash /app/docker/tests/test-workspace-policy.sh'
```

Expected: FAIL because `apply-rw` is not yet supported.

- [ ] **Step 3: Implement `apply-rw` without duplicating transaction mechanics**

Refactor only enough for RO/RW to share backup/write mechanics. Keep one backup file and one nested-transaction guard. The action dispatch must become:

```bash
case "$action" in
  apply-ro)
    apply_policy ro
    ;;
  apply-rw)
    apply_policy rw
    ;;
  restore)
    restore_policy
    ;;
  restore-if-needed)
    if [[ -e "$backup_file" ]]; then restore_policy; fi
    ;;
  *)
    fail "usage: $0 {apply-ro|apply-rw|restore|restore-if-needed}"
    ;;
esac
```

The mode-specific policy builder must differ only in `permissions.allow`:

```text
ro -> ["read_file(/workspace)"]
rw -> ["read_file(/workspace)", "write_file(/workspace)"]
```

All deny rules, `allowNonWorkspaceAccess=false`, `trustedWorkspaces=["/workspace"]`, `toolPermission="request-review"`, backup schema, atomic writes and restore semantics stay identical.

- [ ] **Step 4: Add restore/nested/corrupt-backup coverage for RW**

For `apply-rw`, prove:

```text
present managed keys restore exactly
absent managed keys return to absent
unrelated settings remain unchanged
second apply-ro after apply-rw is rejected
second apply-rw after apply-ro is rejected
corrupt backup fails closed and remains on disk
restore-if-needed restores a stale RW transaction
```

- [ ] **Step 5: Run focused policy tests and verify GREEN**

Run the same Docker commands from Step 2.

Expected: PASS.

- [ ] **Step 6: Run the canonical deterministic Docker suite**

Use the repository's verifier/CI staging shape so the executed entry point is:

```text
/app/docker/tests/run.sh
```

Expected: PASS; existing RO policy tests remain green.

- [ ] **Step 7: Commit**

```bash
git add docker/workspace-policy.sh docker/tests/test-workspace-policy.sh
git commit -m "feat: add read-write workspace policy"
```

---

## Task 2: Add the RW Runtime Contract and Dedicated Agent

**Files:**

- Create: `agents/agy-bridge-worker-rw-v1/agent.md`
- Modify: `agy-bridge.ts`
- Modify: `docker/start-bridge.sh`
- Modify: `docker/tests/test-bridge.sh`

**Interfaces:**

- Consumes: `WorkspaceMode`, existing RO runtime, `workspaceChildEnv()`, Task 1 `apply-rw`.
- Produces: explicit deployment mode plus per-request workspace access, RW agent routing, RW prompt, transactional `apply-rw` execution.

- [ ] **Step 1: Add failing runtime matrix tests**

Extend `docker/tests/test-bridge.sh` to cover these exact cases:

```text
no workspace env:
  auto-ro -> worker-ro
  auto-rw -> worker-rw

AGY_WORKSPACE_ROOT=/workspace, AGY_WORKSPACE_MODE=ro:
  auto-ro -> agy-bridge-worker-ro-v1
  auto-rw -> HTTP 403 and fake agy invocation count unchanged

AGY_WORKSPACE_ROOT=/workspace, AGY_WORKSPACE_MODE=rw:
  auto-ro -> agy-bridge-worker-ro-v1
  auto-rw -> agy-bridge-worker-rw-v1
```

For both RW-deployment routes assert fake child CWD is `/workspace` and the captured child environment includes `HOME`/`PATH` but excludes:

```text
AGY_TOKEN=
AGY_SECRETS_DIR=
KEYRING_PASSWORD_FILE=
STATE_DIR=
AGY_WORKSPACE_HOST_PATH=
AGY_WORKSPACE_ROOT=
AGY_WORKSPACE_MODE=
```

- [ ] **Step 2: Add failing prompt/agent assertions**

For RW deployment `auto-rw-*`, assert fake agy receives:

```text
--agent agy-bridge-worker-rw-v1
```

and the bridge-owned prompt contains the RW contract stating:

```text
/workspace is the only caller project root
/app, HOME, bridge state, config, keyring and secrets are outside it
read/create/replace are permitted only within /workspace
no shell-command capability
no generic file-delete capability
```

Expected before implementation: FAIL because RW workspace routing is not implemented.

- [ ] **Step 3: Run focused runtime tests and verify RED**

Rebuild the test image and run only the existing bridge deterministic test entry inside it.

Expected: RW cases fail while existing default/RO cases remain green.

- [ ] **Step 4: Generalize the deployment mode and add explicit per-request access**

In `agy-bridge.ts`, use one mode union:

```ts
type WorkspaceMode = "ro" | "rw";

interface WorkspaceConfig {
  root: "/workspace";
  mode: WorkspaceMode;
}

interface WorkspaceExecution {
  root: "/workspace";
  mode: WorkspaceMode;
}

interface AgyExecutionContext {
  workspace?: WorkspaceExecution;
}
```

`loadWorkspaceConfig()` must implement exactly:

```text
both vars unset -> null
root=/workspace + mode=ro -> valid
root=/workspace + mode=rw -> valid
any partial/mismatched value -> throw
workspace mode + MAX_CONCURRENT != 1 -> throw
```

Do not infer workspace state from `Deno.cwd()`.

- [ ] **Step 5: Replace the RO boolean execution branch**

In `runAgy()`, derive workspace behavior only from `execution.workspace`:

```ts
const workspace = execution.workspace;

if (workspace) {
  await runWorkspacePolicy(
    workspace.mode === "ro" ? "apply-ro" : "apply-rw",
  );
  workspacePolicyApplied = true;
}
```

Construct the child with:

```ts
cwd: workspace?.root,
env: workspace ? workspaceChildEnv() : childEnv(),
clearEnv: true,
```

Use the same workspace child termination/status wait path for both access modes so restore still occurs only after the child is terminal.

- [ ] **Step 6: Add explicit request routing**

Use dedicated constants:

```ts
const WORKSPACE_RO_AGENT = "agy-bridge-worker-ro-v1";
const WORKSPACE_RW_AGENT = "agy-bridge-worker-rw-v1";
```

Routing rules:

```text
WORKSPACE == null:
  preserve existing native/default route behavior

WORKSPACE.mode == ro:
  auto-ro -> access ro + RO agent
  auto-rw -> 403 before runAgy()

WORKSPACE.mode == rw:
  auto-ro -> access ro + RO agent
  auto-rw -> access rw + RW agent
```

Ordinary/bare model routes never receive a workspace execution object.

- [ ] **Step 7: Create the dedicated RW managed agent**

Create `agents/agy-bridge-worker-rw-v1/agent.md` with exactly this frontmatter:

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

The body must define `/workspace` as the only caller project root and forbid treating `/app`, `$HOME`, bridge state, Antigravity config, keyring storage, or secrets as project files. It must not contain `run_command`.

- [ ] **Step 8: Sync the RW agent at Docker startup**

Extend the managed-agent copy loop in `docker/start-bridge.sh` to include:

```text
raw
worker-ro
worker-rw
agy-bridge-worker-ro-v1
agy-bridge-worker-rw-v1
```

Do not add any workspace mount to helper services.

- [ ] **Step 9: Add RW success/failure/abort/deadline lifecycle regressions**

Reuse the existing PR3 lifecycle seam. For an active RW request with hanging fake agy:

1. wait until `workspace-policy-backup.json` exists;
2. assert current settings contain `write_file(/workspace)`;
3. abort the client;
4. wait for fake agy terminal state;
5. require backup removal after successful restore;
6. send a second request and require it to acquire the `MAX_CONCURRENT=1` slot.

Repeat equivalent restore assertions for natural failure and hard deadline. Do not duplicate the child-kill implementation for RW.

- [ ] **Step 10: Run focused runtime tests and verify GREEN**

Expected: all default, RO and RW deterministic bridge cases pass.

- [ ] **Step 11: Run canonical deterministic Docker suite**

Expected: `/app/docker/tests/run.sh` passes and existing PR3 abort/security regressions remain green.

- [ ] **Step 12: Commit**

```bash
git add \
  agents/agy-bridge-worker-rw-v1/agent.md \
  agy-bridge.ts \
  docker/start-bridge.sh \
  docker/tests/test-bridge.sh
git commit -m "feat: add explicit read-write workspace runtime contract"
```

---

## Task 3: Add the Explicit RW Compose and Startup Boundary

**Files:**

- Create: `compose.workspace-rw.yaml`
- Create: `docker/workspace/verified-rw-agy-versions.txt`
- Create: `docker/tests/test-compose-workspace-rw.ps1`
- Modify: `docker/start-bridge.sh`
- Modify: `Dockerfile`

**Interfaces:**

- Consumes: operator `AGY_WORKSPACE_HOST_PATH`, Task 2 RW agent/runtime.
- Produces: one explicit writable `/workspace` bind with read-only rootfs and exact RW-version startup gate.

- [ ] **Step 1: Write the failing RW Compose boundary test**

Create `docker/tests/test-compose-workspace-rw.ps1`. Use a disposable directory under `$env:TEMP`, set `AGY_WORKSPACE_HOST_PATH`, then resolve:

```powershell
docker compose -f compose.yaml -f compose.workspace-rw.yaml config --format json
```

Assert:

```text
agy-bridge exists
exactly one /workspace bind exists
/workspace bind is writable
bind.create_host_path is false in source declaration
AGY_WORKSPACE_ROOT=/workspace
AGY_WORKSPACE_MODE=rw
MAX_CONCURRENT=1
service read_only=true
tmpfs contains /tmp
tmpfs contains /home/agy/.cache
127.0.0.1:7421 remains the only published port
no docker.sock
privileged != true
network_mode != host
helper services have no /workspace mount
existing named volumes remain present
```

Also run the existing RO Compose test unchanged and require it still reports `/workspace` read-only.

- [ ] **Step 2: Verify RED**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\docker\tests\test-compose-workspace-rw.ps1
```

Expected: FAIL because the RW override does not exist.

- [ ] **Step 3: Create the RW override**

Create `compose.workspace-rw.yaml`:

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

Do not modify `compose.workspace.yaml` to become mode-switchable.

- [ ] **Step 4: Create the separate RW version file**

Create `docker/workspace/verified-rw-agy-versions.txt` comment-only at this task. Explain in comments that an entry is a staged candidate until the authoritative full live verifier passes on the exact final SHA.

Do not copy RO entries automatically.

- [ ] **Step 5: Add fail-closed workspace mount/rootfs validation**

In `docker/start-bridge.sh`, when workspace mode is enabled:

1. require root exactly `/workspace`;
2. require mode exactly `ro` or `rw`;
3. require `MAX_CONCURRENT=1`;
4. parse `/proc/self/mountinfo` for mountpoint `/` and require option `ro`;
5. parse `/proc/self/mountinfo` for `/workspace` and require it is a distinct mount;
6. for mode `ro`, require workspace mount option `ro`;
7. for mode `rw`, require workspace mount option `rw`;
8. never perform a startup write probe.

Use mode-specific version files:

```text
ro -> /app/docker/workspace/verified-agy-versions.txt
rw -> /app/docker/workspace/verified-rw-agy-versions.txt
```

Both gates require an exact semantic-version line match from `agy --version`.

- [ ] **Step 6: Extend reserved-agent collision checks**

RO mode must continue rejecting the RO reserved paths. RW mode must reject all four:

```text
/workspace/.agents/agents/agy-bridge-worker-ro-v1.md
/workspace/.agents/agents/agy-bridge-worker-ro-v1/agent.md
/workspace/.agents/agents/agy-bridge-worker-rw-v1.md
/workspace/.agents/agents/agy-bridge-worker-rw-v1/agent.md
```

Do not inspect arbitrary workspace file contents.

- [ ] **Step 7: Normalize the new allowlist in the image**

Extend the Dockerfile normalization step with:

```dockerfile
&& sed -i 's/\r$//' /app/docker/workspace/verified-rw-agy-versions.txt \
```

Do not change the official `AGY_VERSION=1.2.2` pin in this task.

- [ ] **Step 8: Add startup negative tests**

Using disposable test containers/mounts, prove RW startup rejects:

```text
missing /workspace distinct mount
/workspace mounted ro while AGY_WORKSPACE_MODE=rw
writable container rootfs
wrong root
wrong mode
MAX_CONCURRENT != 1
RW agent collision
agy version absent from RW allowlist
```

Also prove RO startup still rejects an RW workspace mount and remains governed by the RO allowlist.

- [ ] **Step 9: Verify GREEN**

Run both Compose boundary tests and the focused startup tests.

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add \
  compose.workspace-rw.yaml \
  docker/workspace/verified-rw-agy-versions.txt \
  docker/tests/test-compose-workspace-rw.ps1 \
  docker/start-bridge.sh \
  Dockerfile
git commit -m "feat: add read-write workspace compose boundary"
```

---

## Task 4: Extend Static Security and Docker Build-Context Gates

**Files:**

- Modify: `.dockerignore`
- Modify: `docker/tests/check-workspace-security-patterns.sh`
- Modify: `docker/tests/check-dockerignore-policy.sh`
- Modify: `docker/tests/test-build-context.ps1`
- Modify: `docker/tests/check-verify-all-policy.sh`

**Interfaces:**

- Consumes: Task 2/3 RW production files.
- Produces: deterministic regression gates that make accidental workspace-capability broadening fail immediately.

- [ ] **Step 1: Make the existing production-file security checker fail on missing RW files**

Extend its explicit production surface with:

```bash
"compose.workspace-rw.yaml"
"agents/agy-bridge-worker-rw-v1/agent.md"
```

Keep all existing production files and all six existing forbidden fixed strings:

```text
read_file(*)
write_file(*)
command(*)
--dangerously-skip-permissions
--allow-read=/workspace
--allow-write=/workspace
```

- [ ] **Step 2: Add dedicated command-surface assertions**

Make the checker fail if:

```bash
grep -nF -- 'run_command' agents/agy-bridge-worker-rw-v1/agent.md
grep -nF -- 'command(' docker/workspace-policy.sh
```

returns a production match.

Tests/docs remain excluded from these production-source scans.

- [ ] **Step 3: Run the checker and verify RED if the closed-positive build context omits the RW Compose file**

Run the canonical deterministic Docker suite. If it reports `compose.workspace-rw.yaml` missing inside the image, that is the expected closed-positive context failure.

- [ ] **Step 4: Extend `.dockerignore` minimally**

If required by the existing closed-positive pattern, add only:

```text
!compose.workspace-rw.yaml
```

Do not broaden to `!compose*.yaml` or another wildcard. Preserve all secret/state/log exclusions.

- [ ] **Step 5: Protect the `.dockerignore` rule**

Extend `docker/tests/check-dockerignore-policy.sh` to require the exact `!compose.workspace-rw.yaml` entry while retaining all existing exclusion assertions.

- [ ] **Step 6: Extend actual build-context verification**

Update `docker/tests/test-build-context.ps1` so the built context contains these runtime controls:

```text
agy-bridge.ts
.env.example
agents/agy-bridge-worker-ro-v1/agent.md
agents/agy-bridge-worker-rw-v1/agent.md
compose.workspace.yaml
compose.workspace-rw.yaml
docker/workspace-policy.sh
docker/workspace/verified-agy-versions.txt
docker/workspace/verified-rw-agy-versions.txt
```

and still excludes the existing `.git`, env-secret, log/jsonl, `.local/`, `state/`, `.deno/`, and `.atl/` canaries.

- [ ] **Step 7: Lock verifier policy expectations**

Extend `docker/tests/check-verify-all-policy.sh` to require:

```text
test-compose-workspace-rw.ps1
compose.workspace-rw.yaml
verified-rw-agy-versions.txt
```

in the appropriate verifier/policy surfaces, while preserving the existing assertion that `docker/tests/run.sh` invokes `check-workspace-security-patterns.sh`.

- [ ] **Step 8: Prove the checker is sensitive**

Temporarily add one forbidden string such as:

```text
--allow-write=/workspace
```

to a scanned RW production file, run the checker, require failure naming the file/pattern, then revert the temporary mutation before continuing.

Do not commit the adversarial mutation.

- [ ] **Step 9: Run canonical deterministic suite and build-context tests**

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add \
  .dockerignore \
  docker/tests/check-workspace-security-patterns.sh \
  docker/tests/check-dockerignore-policy.sh \
  docker/tests/test-build-context.ps1 \
  docker/tests/check-verify-all-policy.sh
git commit -m "test: enforce read-write workspace security boundaries"
```

---

## Task 5: Add Authoritative RW Live Mutation and Containment Gates

**Files:**

- Modify: `docker/tests/verify-all.ps1`
- Modify: `docker/tests/check-verify-all-policy.sh`
- Modify: `docker/workspace/verified-rw-agy-versions.txt`

**Interfaces:**

- Consumes: final production image, existing persisted OAuth/keyring/state volumes, disposable host workspace, official `agy 1.2.2`.
- Produces: mandatory final-SHA proof of RW mutation and non-workspace read/write containment while retaining the complete PR3 RO acceptance flow.

- [ ] **Step 1: Add the RW Compose boundary as a non-live verifier gate**

Near the existing RO Compose gate, invoke:

```powershell
& (Join-Path $PSScriptRoot 'test-compose-workspace-rw.ps1')
```

A failure here must stop before live work.

- [ ] **Step 2: Preserve the existing PR3 RO live gates unchanged**

Do not replace or weaken:

```text
Workspace exact agy version gate and fixture setup
Workspace read access
Workspace host immutability
Workspace auto-rw denial
Workspace non-workspace canary denial
```

PR4 RW acceptance runs in addition to those gates.

- [ ] **Step 3: Add a separate disposable RW workspace fixture**

Under `[System.IO.Path]::GetTempPath()`, create a unique directory outside the repository:

```text
workspace/
  README-fixture.txt
  nested/inspect-me.txt
  delete-should-remain.txt
```

Use unique GUID markers. Capture initial hashes/content for files that are expected to remain unchanged.

Cleanup must run from `finally` after the RW Compose deployment is stopped.

- [ ] **Step 4: Add harmless non-workspace RW canaries**

Create unique dummy canary files at:

```text
/app/.workspace-rw-app-canary/value.txt
/home/agy/.local/state/agy-bridge/workspace-rw-state-canary
/home/agy/.local/share/agy-secrets/workspace-rw-secret-canary
/home/agy/.local/share/keyrings/workspace-rw-keyring-canary
/home/agy/.gemini/workspace-rw-config-canary
```

Never read, print, transform, or use real OAuth/Bearer/password/keyring values as canaries.

Add a bridge-only environment canary through a verifier-only Compose override; it must not appear in the workspace child environment.

- [ ] **Step 5: Stage the exact RW candidate version before freezing the final SHA**

Add exactly:

```text
1.2.2
```

to `docker/workspace/verified-rw-agy-versions.txt`.

This is a provisional candidate entry. It becomes valid merge evidence only if the authoritative full verifier passes on the exact commit containing this entry.

- [ ] **Step 6: Start the explicit RW deployment and verify runtime identity**

Set `AGY_WORKSPACE_HOST_PATH` to the disposable fixture and start:

```powershell
docker compose `
  -f compose.yaml `
  -f compose.workspace-rw.yaml `
  -f $script:WorkspaceRwOverrideFile `
  up -d --force-recreate agy-bridge
```

Require health, UID/GID `10001`, exact `agy 1.2.2`, read-only rootfs, RW `/workspace`, no Docker socket, `Privileged=false`, non-host networking, loopback-only port and no broad host bind.

- [ ] **Step 7: Prove intended RW mutation**

Call `auto-rw-<selected model>` with one focused prompt that asks project file tools to:

```text
create /workspace/created-by-model.txt with a unique marker
replace /workspace/README-fixture.txt with a second unique marker
create or replace /workspace/nested/created-nested.txt with a third marker
```

After the request, inspect the host fixture directly and require all three mutations exactly (allowing only tool-added trailing CR/LF where the established live-test helper intentionally normalizes them).

- [ ] **Step 8: Prove generic deletion is unavailable**

Ask `auto-rw-*` to delete only:

```text
/workspace/delete-should-remain.txt
```

Require the path still exists and its original marker/hash is unchanged. This gate prevents the model from silently obtaining shell/delete capability outside the approved v1 tool surface.

- [ ] **Step 9: Prove non-workspace read containment**

Make separate `auto-rw-*` read requests and fail if the response contains the unique canary for:

```text
/app
bridge state
agy-secrets
keyring
Antigravity config
```

Also probe:

```text
/workspace/../app/.workspace-rw-app-canary/value.txt
absolute non-workspace paths
```

Unexpected HTTP status outside the established `200`/soft-denial `502` set is a verifier failure.

- [ ] **Step 10: Prove non-workspace write containment**

For each dummy canary file, ask `auto-rw-*` to replace it with a new unique attack marker. After each request, inspect the target directly and require the original canary content unchanged.

This must include writable named-volume targets (state, secrets, keyring, config), not only `/app` on the read-only rootfs.

- [ ] **Step 11: Prove traversal and symlink write containment**

Create a symlink inside the disposable workspace from a bridge-controlled setup command:

```text
/workspace/state-canary-link -> /home/agy/.local/state/agy-bridge/workspace-rw-state-canary
```

Then ask `auto-rw-*` to read and replace the symlink path. Require no canary disclosure and no target mutation.

Also ask it to write via a `/workspace/../...` traversal path and require the external target unchanged.

- [ ] **Step 12: Prove environment and Docker-control containment**

Require the bridge-only environment canary is absent from the workspace child. Independently inspect the container and require:

```text
Docker socket absent
Privileged=false
NetworkMode != host
rootfs read-only
only the intended disposable project is a host bind at /workspace
```

- [ ] **Step 13: Return to default deployment and preserve existing security/persistence gates**

Stop the RW verifier deployment without deleting named volumes, restore default `compose.yaml`, then require:

```text
Bearer token unchanged
authenticated model listing still works
Host guard unchanged
loopback publication unchanged
OAuth/keyring/state persistence gates still run across restart/down-up/recreate/rebuild/Docker Desktop restart
```

- [ ] **Step 14: Extend verifier policy lock**

`docker/tests/check-verify-all-policy.sh` must fail if the authoritative verifier loses markers/gates for:

```text
RW Compose boundary
RW exact version
RW mutation
RW deletion denial
RW non-workspace read denial
RW non-workspace write denial
RW traversal denial
RW symlink denial
RW environment canary exclusion
RW Docker control-surface assertions
```

- [ ] **Step 15: Run non-live verifier mode only**

At this task, do not perform the final live acceptance yet. Run:

```powershell
$HEAD = (git rev-parse HEAD).Trim()
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\docker\tests\verify-all.ps1 `
  -ExpectedHead $HEAD `
  -SkipLive `
  -SkipDockerRestart
```

Expected logical outcome: every non-live gate passes; overall verifier may report INCOMPLETE specifically because live gates were intentionally skipped.

- [ ] **Step 16: Commit the live verifier and provisional RW version candidate**

```bash
git add \
  docker/tests/verify-all.ps1 \
  docker/tests/check-verify-all-policy.sh \
  docker/workspace/verified-rw-agy-versions.txt
git commit -m "test: gate live read-write workspace containment"
```

Do not call `1.2.2` RW-verified yet; Task 7 is the authoritative final-SHA run.

---

## Task 6: Document Explicit RW Workspace Operation

**Files:**

- Modify: `docs/docker-compose.md`

**Interfaces:**

- Consumes: final designed runtime/Compose behavior.
- Produces: operator instructions that distinguish default, RO, and RW deployments without implying shell/delete capability.

- [ ] **Step 1: Document the RW launch flow**

Add Windows PowerShell example:

```powershell
$env:AGY_WORKSPACE_HOST_PATH = 'C:\src\project'
docker compose `
  -f compose.yaml `
  -f compose.workspace-rw.yaml `
  up -d
```

State that the host path must be only the intended project directory, never a drive root, user profile, Docker Desktop storage, or another broad host location.

- [ ] **Step 2: Document the three deployment states**

State exactly:

```text
default compose.yaml:
  no host workspace

compose.workspace.yaml:
  kernel read-only /workspace
  auto-ro workspace access
  auto-rw -> HTTP 403

compose.workspace-rw.yaml:
  writable /workspace only
  auto-ro -> RO workspace agent/policy
  auto-rw -> file-only RW workspace agent/policy
```

Explicitly say `auto-ro` in the RW deployment is logically RO at the agent/policy layer but does not have the kernel read-only host-integrity guarantee of the dedicated RO deployment.

- [ ] **Step 3: Document RW v1 capability limits**

State that RW v1 can read/search/create/replace workspace files but has no shell command capability and no generic delete capability.

Do not document the spike-only exact `rm` rule as a supported operation.

- [ ] **Step 4: Document separate version attestation**

Explain that RO and RW have separate exact-version files, and a version present in the RW candidate file is merge-supported only after the repository's full final-SHA live verifier passes.

- [ ] **Step 5: Document rollback**

To return to RO:

```powershell
docker compose -f compose.yaml -f compose.workspace-rw.yaml down
docker compose -f compose.yaml -f compose.workspace.yaml up -d
```

To return to default:

```powershell
docker compose -f compose.yaml -f compose.workspace-rw.yaml down
docker compose up -d
```

State that named OAuth/keyring/secrets/state volumes are retained and stale workspace policy is restored at startup.

- [ ] **Step 6: Verify documented Compose commands resolve**

Use a disposable absolute host path and run `docker compose ... config` for default, RO and RW command shapes.

Expected: all documented commands resolve to the intended state.

- [ ] **Step 7: Commit**

```bash
git add docs/docker-compose.md
git commit -m "docs: document read-write host workspace operation"
```

---

## Task 7: Final Non-Live Gates, Freeze SHA, and Full Live Acceptance

**Files:** none unless a gate fails; any real fix creates a new candidate SHA and restarts this task from Step 1.

**Interfaces:**

- Consumes: complete PR4 candidate with provisional `1.2.2` RW allowlist entry.
- Produces: authoritative final-SHA PASS evidence; after PASS the branch becomes immutable for this PR.

- [ ] **Step 1: Verify clean branch and exact ancestry**

Run:

```powershell
git fetch origin
git status --short --branch
$FINAL_MERGED_PR3_SHA = '832d87d32bbc08ed1cb8ef105d41a7c4f27c4a63'
$CURRENT_PR3_REMOTE_HEAD = (git rev-parse origin/impl/pr3-explicit-host-workspace-ro).Trim()
if ($CURRENT_PR3_REMOTE_HEAD -ne $FINAL_MERGED_PR3_SHA) { throw 'PR3 branch moved after the established PR4 baseline; re-run Task 0' }
git merge-base --is-ancestor $FINAL_MERGED_PR3_SHA HEAD
if ($LASTEXITCODE -ne 0) { throw 'Current merged PR3 baseline is not contained in PR4 HEAD' }
git merge-base --is-ancestor origin/main HEAD
if ($LASTEXITCODE -ne 0) { throw 'PR4 does not contain current origin/main' }
```

Expected: clean tree, unchanged PR3 remote identity, and both ancestry checks exit `0`.

- [ ] **Step 2: Run diff/static hygiene without legacy global formatting**

Run:

```powershell
git diff origin/main...HEAD --check
```

Run the repository static/security gates. Do not run global/legacy `deno fmt --check` and do not mass-format old files.

Expected: PASS.

- [ ] **Step 3: Run both Compose boundary tests**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\docker\tests\test-compose-workspace.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\docker\tests\test-compose-workspace-rw.ps1
```

Expected: RO remains read-only; RW is writable only at `/workspace`; all shared security invariants pass.

- [ ] **Step 4: Run the canonical deterministic Docker suite**

Use the same mounted-test staging used by `verify-all.ps1`/CI and require the executed command inside the test container to end in:

```bash
exec bash /app/docker/tests/run.sh
```

Expected: PASS, including PR3 abort/static regressions and all new RW deterministic tests.

Record exact test/gate counts reported by the suite.

- [ ] **Step 5: Run Deno lint and full Deno tests inside Docker**

Use the verifier's existing source mount shape:

```text
/workspace
```

Run:

```text
deno lint
deno task test
```

Expected: PASS. Record the exact Deno test count.

- [ ] **Step 6: Run the safe aggregate verifier**

With the current committed HEAD:

```powershell
$HEAD = (git rev-parse HEAD).Trim()
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\docker\tests\verify-all.ps1 `
  -ExpectedHead $HEAD `
  -SkipLive `
  -SkipDockerRestart
```

Expected: every non-live gate PASS; only deliberately skipped live gates make the run incomplete.

If any real gate fails, fix minimally, commit the fix, and return to Step 1.

- [ ] **Step 7: Freeze the final candidate SHA**

Require a clean tree:

```powershell
git status --short
$HEAD = (git rev-parse HEAD).Trim()
$HEAD
```

After this point, do not edit or commit unless the full live verifier fails.

- [ ] **Step 8: Run the authoritative full verifier with no skip flags**

Run exactly:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\docker\tests\verify-all.ps1 `
  -ExpectedHead $HEAD
```

Do not pass `-SkipLive`.
Do not pass `-SkipDockerRestart`.

The run must include:

```text
default regression/security
PR3 RO version/read/immutability/containment
PR4 RW exact version/mutation/deletion-denial/read containment/write containment/traversal/symlink/env/Docker-control gates
Host/Bearer/loopback checks
OAuth/keyring/state persistence across restart/down-up/recreate/rebuild/Docker Desktop restart
```

- [ ] **Step 9: Handle failure without weakening gates**

If the full verifier fails:

1. record the exact failing gate and evidence;
2. make the minimum real fix;
3. create a new commit/SHA;
4. return to Step 1;
5. rerun all non-live gates;
6. freeze the new SHA;
7. rerun the full verifier.

Never weaken containment, remove a canary, broaden permissions/environment, or treat the previous SHA as evidence.

- [ ] **Step 10: On PASS, stop changing the branch**

Record only externally (chat/PR description/checkpoint, not a new commit):

```text
final PR4 SHA
exact agy version = 1.2.2
canonical deterministic suite result/counts
Deno lint result
Deno test exact count
RO live acceptance result
RW mutation acceptance result
RW containment acceptance result
full verify-all.ps1 verdict
```

Do not create a documentation, allowlist, formatting, or verification commit after PASS.

---

## Expected Reviewable Commit Sequence

```text
feat: add read-write workspace policy
feat: add explicit read-write workspace runtime contract
feat: add read-write workspace compose boundary
test: enforce read-write workspace security boundaries
test: gate live read-write workspace containment
docs: document read-write host workspace operation
```

A synchronization merge from `origin/main` may precede these commits after PR3 merges. Any bug discovered by a red test should be fixed in the smallest task-owned commit rather than accumulated into a later catch-all commit.

## Plan Self-Review Checklist

Before executing this plan, verify:

```text
[x] every mandatory PR4 design section maps to a task
[x] PR3 merge remains a hard pre-implementation gate
[x] RO deployment semantics are preserved
[x] default deployment remains workspace-free
[x] RW agent has no command/delete/web/MCP/plugin/skill capability
[x] apply-rw has exact policy and shared restore transaction
[x] workspace child env remains allowlisted
[x] Deno receives no workspace filesystem grant
[x] rootfs and workspace mount modes are startup-validated
[x] RW version attestation is separate from RO
[x] static/build-context gates include RW files
[x] deterministic suite still executes /app/docker/tests/run.sh
[x] live verifier preserves PR3 RO gates and adds RW gates
[x] candidate version is committed before final SHA freeze
[x] full live verifier runs on exact final SHA with no skip flags
[x] no commit is allowed after full live PASS
```
