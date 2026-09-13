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

## Workspace and filesystem boundary

This Docker runtime does **not** mount or infer an HTTP caller's project
workspace.

`/app` contains the `agy-bridge` application source baked into the image. It is
not the caller's workspace, and the bridge does not infer a caller workspace
from `Deno.cwd()`.

The deployment does not automatically grant `read_file(/app)`,
`write_file(/app)`, or command permissions to turn `/app` into an implicit
workspace. Explicit host workspace support belongs in a separate later runtime
change; this verifier/docs layer does not add it.

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
workflow checks out the exact PR head SHA, verifies the frozen PR2 base and PR3
changed-path scope, prints Linux/Docker/commit identity, rejects Docker Desktop,
and runs the Docker deterministic suite plus `deno lint` and `deno task test`
inside the test image. `COMPOSE_PROJECT_NAME` is unique per Actions run so cleanup
with `down -v` only touches disposable CI state.

For the first pre-merge evidence run, push the exact
`impl/docker-verifier-docs` head to its remote branch. The workflow has a scoped
`push` trigger for that branch and uses the frozen PR2 SHA above as its identity
base. `workflow_dispatch` remains available for later manual reruns, but GitHub
only accepts that event after the workflow file exists on the repository default
branch, so it is not the bootstrap path for this new workflow.

**Linux Docker Engine evidence is pending until that workflow has an actual green
run on the exact PR3 head.** The workflow file itself is not evidence. Retain the
Actions run URL and exact commit SHA with the PR/review record after it passes.

A PowerShell helper additionally validates resolved Compose defaults and the
loopback-only security boundary:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\docker\tests\test-compose.ps1
```

That PowerShell helper is a test convenience; it is not a runtime requirement.

For the complete acceptance harness on Windows PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\docker\tests\verify-all.ps1 -BaseRef bcf2f2532be7d32a78167d745a700f8a480114e0
```

This verifier is stacked on the frozen PR2 runtime commit
`bcf2f2532be7d32a78167d745a700f8a480114e0`. Keep `-BaseRef` explicit: the
identity gate requires that exact SHA, proves it is an ancestor of `HEAD`, and
rejects dirty tracked or untracked checkout state plus PR3 changes outside
`docker/tests/**`, this deployment guide, and the exact Linux deterministic
workflow path. The full verifier also validates
that arbitrary local-only files cannot enter the Docker build context before the live
OAuth/API/persistence gates and explicit Docker Desktop restart checkpoint. For a non-destructive
deterministic pass, add `-SkipLive -SkipDockerRestart`; the verifier
intentionally exits with code `2` and `VERDICT: INCOMPLETE` when mandatory live
gates are skipped. That is not equivalent to release acceptance.

## Live acceptance coverage

Before release, live acceptance should cover:

1. authenticated `GET /v1/models`;
2. one non-stream completion;
3. one streaming completion ending in `data: [DONE]`;
4. one non-filesystem `auto-ro-*` request;
5. one non-destructive `auto-rw-*` request;
6. OAuth persistence across restart, down/up, recreation, rebuild, and host
   Docker-runtime restart;
7. bridge-state persistence;
8. isolated `down -v` reset behavior.

Do not advertise a host/runtime combination as live-verified merely because the
deterministic suite is green. Run the full acceptance harness without skip flags
using the exact pinned CLI version and retain the resulting gate summary as the
verification evidence.

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
