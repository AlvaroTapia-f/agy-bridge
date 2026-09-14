# Docker Compose Deployment

This guide documents the Docker Compose deployment path for `agy-bridge`. The
Compose configuration is host-OS-neutral: the application, Deno runtime,
official Google Antigravity `agy` CLI, D-Bus, and GNOME Keyring all run inside
Linux containers. The host only needs a supported Docker runtime with Docker
Compose v2.

The project trust boundary does not change in Docker: **all traffic to Google is
performed by the official `agy` CLI using its own account OAuth session**. The
bridge does not implement Google OAuth, does not read or copy Google
access/refresh tokens, and does not fall back to `GEMINI_API_KEY` or Google
Cloud ADC.

The OpenAI-compatible API is published only on host loopback by default:

```text
http://127.0.0.1:7421/v1
```

## Platform support and verification status

The Compose file itself does not contain host-specific bind mounts or host path
assumptions. The current Dockerfile intentionally pins the official Linux x64
`agy` artifact, version `1.2.2`, together with its SHA-512 digest. The build
verifies that digest before extracting the binary; it does not execute a remote
installer script.

| Host environment                               | Status                                                                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Docker Desktop / Docker Engine on x86_64 hosts | Supported by the pinned Linux x64 image path; run the verifier on the target host before release                       |
| ARM64 hosts, including Apple Silicon           | Not supported by the current pin; update the official artifact URL and checksum only after validating an ARM64 release |

The deterministic verifier covers image construction, checksum policy, secrets,
keyring behavior, Compose boundaries, bridge behavior, lint, and the Deno suite.
Fresh OAuth enrollment and persistence are live/manual acceptance gates and must
be rerun for the exact pinned CLI/runtime before claiming a host is
live-verified.

## Requirements

On the host you need:

- Docker Desktop or Docker Engine;
- Docker Compose v2 (`docker compose`);
- a Google account with valid Antigravity / Google AI Pro access;
- host port `7421` available on `127.0.0.1`.

You do **not** need to install Deno, `agy`, Python, Bash, systemd, or OpenCode
on the host for this deployment path.

## First build and OAuth login

From the repository root:

```sh
docker compose build
docker compose run --rm agy-auth
docker compose up -d
docker compose run --rm print-token
```

During `agy-auth`, the official CLI owns the account OAuth flow. Follow the
prompts emitted by the pinned CLI. The wrapper intentionally does **not** fake
`SSH_CONNECTION` or `SSH_TTY` to force a remote-login branch. Initial browser or
headless-login behavior is therefore treated as version-specific live
acceptance, not something the deterministic suite pretends to prove. Do not save
OAuth URLs, codes, cookies, or credentials in the repository.

After successful login, credentials are stored in Docker named volumes and are
reused by later containers.

## Get the local bridge Bearer token

`print-token` prints only the bridge-local Bearer token:

```sh
docker compose run --rm print-token
```

Expected format:

```text
AGY_TOKEN=<48 lowercase hex characters>
```

This is **not** a Google token. Use it only for the local bridge API:

```text
Base URL: http://127.0.0.1:7421/v1
Authorization: Bearer <AGY_TOKEN>
```

Example with curl:

```sh
AGY_TOKEN="$(docker compose run --rm print-token 2>/dev/null | sed -n 's/^AGY_TOKEN=//p' | tail -n 1)"
curl -fsS \
  -H "Authorization: Bearer $AGY_TOKEN" \
  http://127.0.0.1:7421/v1/models
```

PowerShell equivalent:

```powershell
$line = docker compose run --rm print-token
$token = ($line | Where-Object { $_ -match '^AGY_TOKEN=' } | Select-Object -Last 1) -replace '^AGY_TOKEN=', ''
curl.exe -fsS -H "Authorization: Bearer $token" http://127.0.0.1:7421/v1/models
```

## Normal lifecycle

Start the production service:

```sh
docker compose up -d
```

By design, default Compose startup enables only `agy-bridge`.

The helper services are opt-in under the `tools` profile and remain explicitly
runnable with `docker compose run --rm ...`:

- `agy-auth`
- `print-token`
- `init-secrets`

The deterministic `test` service is under the `test` profile.

Check service state and logs:

```sh
docker compose ps
docker compose logs --no-color --tail 100 agy-bridge
```

Health endpoint:

```sh
curl -fsS http://127.0.0.1:7421/healthz
```

## Persistent state

The deployment uses four named volumes:

```text
agy-config   -> /home/agy/.gemini
agy-keyring  -> /home/agy/.local/share/keyrings
agy-secrets  -> /home/agy/.local/share/agy-secrets
bridge-state -> /home/agy/.local/state/agy-bridge
```

Their roles are:

- `agy-config`: Antigravity CLI configuration and managed agent profiles;
- `agy-keyring`: GNOME Keyring / Secret Service data used by the official OAuth
  session;
- `agy-secrets`: the local keyring password and bridge Bearer token;
- `bridge-state`: persistent bridge operational state, including `usage.jsonl`.

As long as those named volumes remain, the deployment is designed to preserve
OAuth across:

- `docker compose restart agy-bridge`;
- `docker compose down` followed by `docker compose up -d`;
- container recreation;
- image rebuilds;
- a restart of the host Docker runtime.

## Stop without deleting OAuth

```sh
docker compose down
```

This removes project containers and the project network but keeps named volumes.
OAuth/config/secrets/state therefore remain available for the next startup.

## Rebuild the image

To rebuild the current pinned runtime:

```sh
docker compose build --pull --no-cache
docker compose up -d --force-recreate
```

Named volumes are not removed by these commands.

`docker compose build --pull` does **not** upgrade `agy`: the CLI artifact is
deliberately pinned in `Dockerfile`. To update it, change `AGY_VERSION`,
`AGY_ARTIFACT_URL`, and `AGY_ARTIFACT_SHA512` together from an official release
manifest, then rebuild and rerun the complete verifier. Never replace this with
an unchecked `curl | sh` installer path.

## Full destructive reset

```sh
docker compose down -v
```

**Warning:** `down -v` removes the project config, keyring, local secrets, and
bridge state. After this reset, run account OAuth again:

```sh
docker compose run --rm agy-auth
```

Do not use `down -v` as part of the normal update or restart cycle.

## Network security

Compose publishes exactly:

```text
127.0.0.1:7421 -> container:7421
```

Inside the container, the bridge listens on `0.0.0.0:7421` so Docker port
forwarding can reach it. That does not expose the service to the LAN because the
host-side publication is restricted to loopback.

Do not change the mapping to an unqualified:

```text
7421:7421
```

unless you intentionally want a wider host exposure and have separately designed
an appropriate security model.

If host port `7421` is unavailable, change only the host side, for example:

```yaml
ports:
  - "127.0.0.1:17421:7421"
```

Then use:

```text
http://127.0.0.1:17421/v1
```

The Docker runtime also preserves these boundaries:

- non-root UID/GID `10001`;
- `MAX_CONCURRENT=1` by default;
- mandatory local Bearer auth, fail-closed on missing/malformed token;
- Host guard against unsupported host headers;
- no `privileged` mode;
- no `network_mode: host`;
- no Docker socket mount;
- no broad host filesystem mount.

## Explicit read-only host workspace

The secure default remains workspace-free:

```powershell
docker compose up -d
```

With only `compose.yaml`, no host project is mounted, `/app` remains bridge
application code, and `auto-ro-*` / `auto-rw-*` retain their existing
non-host-workspace behavior. The bridge never infers a caller workspace from
`Deno.cwd()`.

PR #3 adds an **explicit, one-project, read-only** Docker override. On Windows
PowerShell, point `AGY_WORKSPACE_HOST_PATH` only at the intended project:

```powershell
$env:AGY_WORKSPACE_HOST_PATH = 'C:\src\project'

docker compose `
  -f compose.yaml `
  -f compose.workspace.yaml `
  up -d
```

Do not use `C:\`, a user profile, Docker Desktop storage, or another broad
host path. The selected directory is mounted exactly at `/workspace` with a
Docker-enforced read-only bind. Only `agy-bridge` receives that mount; helper
services do not.

Workspace routing is deliberately asymmetric:

```text
auto-ro-* -> explicit /workspace read-only project access
auto-rw-* -> HTTP 403 before agy is spawned
ordinary/bare models -> no host workspace capability is implied
```

Workspace `auto-ro-*` runs with the reserved Docker read-only agent, child CWD
`/workspace`, a bridge-owned workspace contract, a strict child-environment
allowlist, and a transactional Antigravity read policy. The bridge itself does
not receive Deno read/write permission for `/workspace`.

### Exact `agy` version gate

Explicit workspace mode is fail-closed against unverified official `agy`
versions. `docker/workspace/verified-agy-versions.txt` contains only exact
semantic versions that have passed the full live workspace containment
verifier on the final candidate PR SHA.

An explicit update to the pinned CLI artifact may install a newer official CLI. Default no-workspace mode
continues to work, but workspace startup intentionally refuses that new version
until it passes the repository verifier and is explicitly added to the
allowlist. Do not add a version based only on unit, static, or Compose tests.

### Return to the default deployment

```powershell
docker compose -f compose.yaml -f compose.workspace.yaml down
docker compose up -d
```

Named OAuth/keyring/secrets/state volumes are retained. Startup also restores
any stale managed workspace-policy transaction before the normal OAuth/model
preflight.

## Explicit read-write host workspace

PR #4 adds a separate **explicit, one-project, read-write** deployment. Point
`AGY_WORKSPACE_HOST_PATH` only at the intended project directory, then layer the
RW override on top of the default Compose file:

```powershell
$env:AGY_WORKSPACE_HOST_PATH = 'C:\src\project'

docker compose `
  -f compose.yaml `
  -f compose.workspace-rw.yaml `
  up -d
```

Never use a drive root, user profile, Docker Desktop storage directory, or
another broad host location as the RW workspace. The selected project is the
only host bind at `/workspace`; that bind is writable, while the container root
filesystem remains read-only and `MAX_CONCURRENT=1` remains mandatory.

The deployment model has three explicit states:

```text
default compose.yaml:
  no host workspace

compose.workspace.yaml:
  kernel read-only /workspace
  auto-ro-* -> read-only workspace agent/policy
  auto-rw-* -> HTTP 403 before agy is spawned

compose.workspace-rw.yaml:
  writable /workspace only
  auto-ro-* -> read-only workspace agent/policy
  auto-rw-* -> file-only read-write workspace agent/policy
```

`auto-ro-*` inside the RW deployment is logically read-only at the managed
agent and Antigravity policy layers, but the deployment itself still exposes a
writable host bind. It therefore does **not** provide the kernel-level host
integrity guarantee of the dedicated `compose.workspace.yaml` deployment.
Operators requiring kernel-enforced host immutability must use the RO override.

RW v1 is intentionally file-only. It can read/search project files and
create/replace files under `/workspace`; it has no shell-command capability,
no generic file-delete capability, and no web/MCP/plugin/skill surface. The
bridge process itself still receives no Deno read/write grant for `/workspace`.

### Separate RO/RW `agy` version attestation

RO and RW deployments have independent exact-version files:

```text
RO -> docker/workspace/verified-agy-versions.txt
RW -> docker/workspace/verified-rw-agy-versions.txt
```

An entry in the RW file is only a staged candidate until the repository's full
final-SHA verifier passes without live/Docker-restart skip flags on that exact
commit. Do not infer RW support from the RO allowlist or from deterministic-only
tests.

### Roll back from RW mode

Return to the kernel-enforced RO workspace deployment:

```powershell
docker compose -f compose.yaml -f compose.workspace-rw.yaml down
docker compose -f compose.yaml -f compose.workspace.yaml up -d
```

Or return to the secure default with no host workspace:

```powershell
docker compose -f compose.yaml -f compose.workspace-rw.yaml down
docker compose up -d
```

These transitions do not delete the named OAuth, keyring, secrets, or bridge
state volumes. Startup restores any stale transactional workspace policy before
normal bridge preflight.

## API examples

List models:

```sh
curl -fsS \
  -H "Authorization: Bearer $AGY_TOKEN" \
  http://127.0.0.1:7421/v1/models
```

Non-stream completion:

```sh
curl -fsS \
  -H "Authorization: Bearer $AGY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-3.8-flash-low","messages":[{"role":"user","content":"Reply with exactly: docker-ok"}],"stream":false}' \
  http://127.0.0.1:7421/v1/chat/completions
```

Autonomous routing prefixes remain:

```text
auto-ro-<model>
auto-rw-<model>
```

These routes select the managed Antigravity agents. Their existence does not
imply host workspace access for either route.

## Deterministic verification

Build and run the Docker-specific deterministic suite:

```sh
docker compose --profile test build test
docker compose --profile test run --rm \
  -v "$PWD/docker/tests:/app/docker/tests:ro" \
  -v "$PWD/docs/docker-compose.md:/app/docs/docker-compose.md:ro" \
  test bash /app/docker/tests/run.sh
```

The production build context uses a closed positive allowlist and intentionally
does not bake verifier/tests/docs into the runtime image. The deterministic
suite bind-mounts those verifier inputs read-only instead. The Deno checks use
the same runtime image with the checkout mounted read-only at `/workspace`:

```sh
docker compose --profile test run --rm -v "$PWD:/workspace:ro" -w /workspace test deno lint
docker compose --profile test run --rm -v "$PWD:/workspace:ro" -w /workspace test deno task test
```

For portability evidence, run the deterministic suite from a Linux Docker
Engine/CLI environment and also run the Windows PowerShell Compose boundary plus
live Docker Desktop restart gate. A green deterministic run on one host is not a
substitute for live verification on another.

The repository includes `.github/workflows/linux-docker-deterministic.yml` for
deterministic Linux Docker Engine evidence on GitHub Actions `ubuntu-24.04`. The
workflow checks out the exact PR head SHA, verifies the frozen main base and PR3
changed-path scope, prints Linux/Docker/commit identity, rejects Docker Desktop,
and runs the Docker deterministic suite plus `deno lint` and `deno task test`
inside the test image. `COMPOSE_PROJECT_NAME` is unique per Actions run so cleanup
with `down -v` only touches disposable CI state.

For the first pre-merge evidence run, push the exact
`impl/pr3-explicit-host-workspace-ro` head to its remote branch. The workflow has a scoped
`push` trigger for that branch and uses the frozen main SHA above as its identity
base. `workflow_dispatch` remains available for later manual reruns, but GitHub
only accepts that event after the workflow file exists on the repository default
branch, so it is not the bootstrap path for this new workflow.

**Linux Docker Engine evidence is pending until that workflow has an actual green
run on the exact PR3 head.** The workflow file itself is not evidence. Retain the
Actions run URL and exact commit SHA with the PR/review record after it passes.

PowerShell helpers additionally validate resolved Compose defaults, the
loopback-only security boundary, and both explicit workspace overrides:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\docker\tests\test-compose.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\docker\tests\test-compose-workspace.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\docker\tests\test-compose-workspace-rw.ps1
```

Those PowerShell helpers are test conveniences; they are not runtime
requirements.

## Full Windows + Docker Desktop acceptance

`docker/tests/verify-all.ps1` is the end-to-end acceptance helper for this
Docker deployment. It retains the complete PR #3 read-only workspace gates,
then adds PR #4 RW exact-version, intended mutation, deletion-denial,
non-workspace read/write, traversal, symlink, child-environment, and Docker
control-surface gates. It returns to the default deployment before re-running
the existing OAuth/state persistence transitions across restart, down/up,
recreation, rebuild, and a Docker Desktop restart.

Run it from the repository checkout you intend to validate:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\docker\tests\verify-all.ps1 -BaseRef 06567660cb765285cf68f28637169c79ddd1aabc
```

This verifier is based on the PR3 integration commit
`06567660cb765285cf68f28637169c79ddd1aabc`, which directly contains final PR3
`832d87d32bbc08ed1cb8ef105d41a7c4f27c4a63`. Keep `-BaseRef` explicit: the
identity gate requires that exact integration SHA, proves the final PR3 ancestry
and that the base is an ancestor of `HEAD`, then
rejects dirty tracked or untracked checkout state and changes outside the
explicit PR4 workspace runtime, test, design-document, and deployment-guide
paths listed in `docker/tests/assert-pr3-identity.ps1`. The full verifier also validates
that arbitrary local-only files cannot enter the Docker build context before the live
OAuth/API/persistence gates and explicit Docker Desktop restart checkpoint. For a non-destructive
deterministic pass, add `-SkipLive -SkipDockerRestart`; the verifier
intentionally exits with code `2` and `VERDICT: INCOMPLETE` when mandatory live
gates are skipped. That is not equivalent to release acceptance.

## Live acceptance coverage

Before release, live acceptance should cover:

1. authenticated `GET /v1/models` plus official-`agy` non-stream and streaming
   calls;
2. the existing PR #3 RO exact-version/read/immutability/`auto-rw`-403 and
   non-workspace containment gates;
3. exact RW `agy` candidate version plus host-visible create/replace/nested
   mutations under the disposable `/workspace` project;
4. generic deletion remaining unavailable in RW v1;
5. denial of harmless `/app`, bridge-state, agy-secrets, keyring, config,
   absolute-path, traversal, and workspace-symlink read/write probes;
6. bridge-only environment canary exclusion from the live workspace `agy`
   child;
7. read-only container rootfs, only the intended writable `/workspace` host
   bind, no Docker socket, no privileged mode, no host networking, and
   loopback-only publication;
8. Host/Bearer guards after returning to default mode;
9. OAuth/state persistence across restart, down/up, recreation, rebuild, and
   Docker Desktop restart;
10. bridge-state persistence and isolated `down -v` reset behavior.

The default Docker deployment has already been live-verified on a Windows
x86_64 Docker Desktop host for the PR #2 OAuth/persistence boundaries. Explicit
read-write host-workspace support must **not** be advertised as live-verified
until the full PR #4 verifier passes without `-SkipLive` and without
`-SkipDockerRestart` on the frozen final candidate SHA. Only that exact passing
SHA/version combination is authoritative RW evidence.

## Troubleshooting

| Symptom                                                        | Action                                                                                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Antigravity requires authentication or startup preflight fails | `docker compose run --rm agy-auth`                                                                          |
| Keyring cannot be unlocked                                     | Inspect `docker compose logs agy-bridge` and confirm the named volumes still exist before re-authenticating |
| `agy` is obsolete or rejected                                  | Update the pinned version, official artifact URL, and SHA-512 together; rebuild; then rerun the verifier    |
| `401` from `/v1/models`                                        | Retrieve the local Bearer with `docker compose run --rm print-token` and send `Authorization: Bearer ...`   |
| `403` with an unexpected Host header                           | Use `127.0.0.1` or `localhost`                                                                              |
| Host port `7421` is occupied                                   | Change only the loopback host-side port mapping                                                             |
| Complete local reset is required                               | `docker compose down -v`, then run `agy-auth` again                                                         |
| Service is down or unhealthy                                   | `docker compose ps` and `docker compose logs --no-color --tail 100 agy-bridge`                              |
