# Docker Compose Deployment

This guide documents the Docker Compose deployment path for `agy-bridge`.
The Compose configuration is host-OS-neutral: the application, Deno runtime,
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
assumptions. Compatibility still depends on Docker being able to build/run the
Linux image and on the official `agy` installer supporting the container CPU
architecture.

| Host environment | Status |
| --- | --- |
| Docker Desktop on Windows, x86_64 | Live-verified, including a Docker Desktop restart |
| Docker Engine + Compose v2 on x86_64 Linux hosts | Expected compatible from the host-neutral Compose design; not yet live-verified |
| Docker Desktop on Intel macOS hosts | Expected compatible from the host-neutral Compose design; not yet live-verified |
| ARM64 hosts, including Apple Silicon | Do not claim support until the official `agy` installer/binary is explicitly verified for the container architecture |

The live acceptance evidence came from one Docker Desktop x86_64 host. That is
verification provenance, not a product restriction.

## Requirements

On the host you need:

- Docker Desktop or Docker Engine;
- Docker Compose v2 (`docker compose`);
- a Google account with valid Antigravity / Google AI Pro access;
- host port `7421` available on `127.0.0.1`.

You do **not** need to install Deno, `agy`, Python, Bash, systemd, or OpenCode on
the host for this deployment path.

## First build and OAuth login

From the repository root:

```sh
docker compose build
docker compose run --rm agy-auth
docker compose up -d
docker compose run --rm print-token
```

During `agy-auth`, the official CLI starts its account OAuth flow. Open the
authorization URL in your host browser, complete Google sign-in, and return any
required authorization code to the terminal. Do not save OAuth URLs, codes,
cookies, or credentials in the repository.

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

## Rebuild or update the image

To rebuild from current base packages and reinstall the official `agy` CLI:

```sh
docker compose build --pull --no-cache
docker compose up -d --force-recreate
```

Named volumes are not removed by these commands.

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

An image rebuild may install a newer official CLI. Default no-workspace mode
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

## API examples

List the models currently exposed by the authenticated `agy` session:

```sh
curl -fsS \
  -H "Authorization: Bearer $AGY_TOKEN" \
  http://127.0.0.1:7421/v1/models
```

Choose a model id returned by that endpoint and use it as `<MODEL_ID>` below.
Do not assume that a particular Antigravity model slug will remain available
forever; the live catalog is the source of truth.

Non-stream completion:

```sh
curl -fsS \
  -H "Authorization: Bearer $AGY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"<MODEL_ID>","messages":[{"role":"user","content":"Reply with exactly: docker-ok"}],"stream":false}' \
  http://127.0.0.1:7421/v1/chat/completions
```

Autonomous routing prefixes remain:

```text
auto-ro-<model>
auto-rw-<model>
```

These routes select the managed Antigravity agents. This deployment does not
imply host workspace access for either route.

## Deterministic verification

Build and run the Docker-specific deterministic suite:

```sh
docker compose --profile test build test
docker compose --profile test run --rm test
```

The Deno checks can also run inside the image:

```sh
docker compose --profile test run --rm test deno lint
docker compose --profile test run --rm test deno task test
```

PowerShell helpers additionally validate resolved Compose defaults, the
loopback-only security boundary, and the explicit read-only workspace override:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\docker\tests\test-compose.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\docker\tests\test-compose-workspace.ps1
```

Those PowerShell helpers are test conveniences; they are not runtime
requirements.

## Full Windows + Docker Desktop acceptance

`docker/tests/verify-all.ps1` is the end-to-end acceptance helper for this
Docker deployment. In addition to the PR #2 gates, it validates the explicit
workspace Compose boundary, requires the exact installed `agy` candidate to be
staged in the verified-version allowlist, proves workspace fixture reads,
proves host-project immutability, requires workspace `auto-rw-*` HTTP 403, and
checks non-workspace canaries including traversal attempts. It then returns to
the default deployment and re-runs the OAuth/state persistence transitions
across restart, down/up, recreation, rebuild, and a Docker Desktop restart.

Run it from the repository checkout you intend to validate:

```powershell
$HEAD = (git rev-parse HEAD).Trim()

powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\docker\tests\verify-all.ps1 `
  -ExpectedHead $HEAD
```

The verifier accepts `-SkipLive` and `-SkipDockerRestart` for partial/local
checks, but either switch makes the result incomplete for full acceptance. A
full acceptance run must execute the live official-`agy` and Docker-restart
gates without those skip switches.

## Live acceptance coverage

A full live acceptance run covers:

1. authenticated `GET /v1/models` plus official-`agy` non-stream and streaming
   calls;
2. the exact official `agy` semantic version used for workspace mode;
3. `auto-ro-*` reading both disposable `/workspace` fixture files;
4. unchanged host hashes, timestamps, content, and directory entries after
   model mutation requests;
5. workspace `auto-rw-*` returning HTTP 403 without project mutation;
6. denial of harmless `/app`, bridge-state, agy-secrets, keyring, and traversal
   canaries;
7. Host/Bearer/loopback boundaries after returning to default mode;
8. OAuth/state persistence across restart, down/up, recreation, rebuild, and
   Docker Desktop restart;
9. bridge-state persistence and isolated `down -v` reset behavior.

The default Docker deployment has already been live-verified on a Windows
x86_64 Docker Desktop host for the PR #2 OAuth/persistence boundaries. Explicit
host-workspace support must **not** be advertised as live-verified until the
full PR #3 verifier passes without `-SkipLive` and without
`-SkipDockerRestart` on the final candidate SHA and the exact passing `agy`
version is retained in the allowlist.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Antigravity requires authentication or startup preflight fails | `docker compose run --rm agy-auth` |
| Keyring cannot be unlocked | Inspect `docker compose logs agy-bridge` and confirm the named volumes still exist before re-authenticating |
| `agy` is obsolete or rejected | `docker compose build --pull --no-cache` followed by `docker compose up -d --force-recreate` |
| `401` from `/v1/models` | Retrieve the local Bearer with `docker compose run --rm print-token` and send `Authorization: Bearer ...` |
| `403` with an unexpected Host header | Use `127.0.0.1` or `localhost` |
| Host port `7421` is occupied | Change only the loopback host-side port mapping |
| Complete local reset is required | `docker compose down -v`, then run `agy-auth` again |
| Service is down or unhealthy | `docker compose ps` and `docker compose logs --no-color --tail 100 agy-bridge` |
