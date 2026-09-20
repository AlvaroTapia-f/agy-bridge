# agy-bridge

Puente local **OpenAI-compatible** que expone los modelos de tu suscripción de
Google Antigravity para cualquier cliente (opencode en particular).

Regla innegociable: **todo el tráfico hacia Google lo realiza el binario
oficial `agy` (CLI de Antigravity) en modo headless, con su propia
autenticación**. El bridge jamás lee ni copia tokens, no hace OAuth propio y
solo escucha en `127.0.0.1`.

Respeto del servicio (no romper):

- **Solo el binario oficial**, de a **una llamada por vez** (`MAX_CONCURRENT=1`).
- **Tres agentes según costo/riesgo:** `raw` (escape hatch costoso, no
  recomendado), `worker-ro` (autónomo solo lectura), `worker-rw` (autónomo
  lectura/escritura, nunca `commit`/`push` sin pedido explícito).
- **Mantené `agy` actualizado** (versiones viejas son rechazadas server-side) y
  nunca expongas el servicio fuera de localhost.

> Profundidad para desarrolladores y operadores (diagrama, invariantes
> completas, sesiones, protocolo de tools, streaming):
> [`docs/architecture.md`](docs/architecture.md).

## Requisitos

Común a ambos sistemas:

| Necesitás | Detalle |
|---|---|
| Suscripción de Google Antigravity | El bridge solo spawnea el `agy` oficial, no hace login por vos |
| `opencode` (v1.18+) | Si no existe `~/.config/opencode/opencode.json` (Linux) o `%USERPROFILE%\.config\opencode\opencode.json` (Windows), el provider se cablea a mano (ver abajo) |
| Puerto `7421` libre en `127.0.0.1` | Bind loopback; nunca exponer fuera de localhost |

Linux (instalador nativo):

| Necesitás | Detalle |
|---|---|
| `agy` CLI instalado y autenticado | `agy --help` y `agy models` deben funcionar |
| `deno` (v2.9.5+) | **Prerrequisito estricto**, también para la sincronización de modelos (`deno --version`; buscado en `PATH` y rutas estándar) |
| Linux con `systemd --user` | Para `agy-bridge.service`; sin systemd podés correr directo con `deno run` ([ver internals](docs/installer-internals.md#opción-c-instalación-manual)) |
| `python3` | Solo para la configuración base de provider/auth en `opencode.json` y el parche de TUI |
| `openssl` o `xxd` + `/dev/urandom` | Para generar el `AGY_TOKEN` de 24 bytes |

Windows (vía Docker):

| Necesitás | Detalle |
|---|---|
| Docker Desktop + Compose v2 | `docker compose version` debe funcionar; no necesitás instalar `deno`, `agy`, `python3` ni `systemd` en el host |
| Host x86_64 | La imagen fija el artefacto Linux x64 de `agy`; **ARM64 no soportado** ([detalle](docs/docker-compose.md#platform-support-and-verification-status)) |
| Git | Para clonar el repo (`git clone`) |
| `curl.exe` | En PowerShell, usar `curl.exe` (el alias `curl` de PowerShell no sirve para los flags `-fsS -H`) |

En Linux, `~/.config/agy-bridge/env` y `~/.local/share/opencode/auth.json`
quedan en `chmod 600` automáticamente. En Windows/Docker, el token y el
keyring viven dentro de volúmenes Docker con nombre (ver
[`docs/docker-compose.md`](docs/docker-compose.md#persistent-state)); nunca
los comitees al repo.

## Instalación en Linux (3 pasos)

**1. Verificá los [requisitos](#requisitos)** (sobre todo `agy` autenticado y
`deno`).

**2. Corré el instalador** (no requiere ni usa `sudo`; auditable antes de
ejecutar — [detalle](docs/installer-internals.md#opción-a-one-liner-remoto)):

```sh
# Instalación estándar (auth manual vía /connect, ver paso 3)
curl -fsSL https://raw.githubusercontent.com/AlvaroTapia-f/agy-bridge/main/install-remote.sh | bash

# Recomendado en máquina limpia: configura auth.json automáticamente
curl -fsSL https://raw.githubusercontent.com/AlvaroTapia-f/agy-bridge/main/install-remote.sh | bash -s -- --with-auth
```

El instalador registra provider, plugin y modelos (14 ids `auto-ro/rw-*` con
variantes `reasoningEffort` vía `scripts/sync-models.ts`). Sin el plugin solo
hay resolución live; **sin el mapa de modelos en `opencode.json` no hay
efforts** ([cómo funciona](docs/installer-internals.md#sincronización-de-modelos)).

**3. Verificá que anda** (el instalador ya registró provider, plugin y modelos):

```sh
source ~/.config/agy-bridge/env
curl -s http://127.0.0.1:7421/healthz
curl -s -H "Authorization: Bearer $AGY_TOKEN" http://127.0.0.1:7421/v1/models | head -c 300
```

Si el primer comando no devuelve `{"ok":true}`, andá a
[Problemas comunes](#problemas-comunes). Checklist completo de verificación
(auth, Host guard, variantes):
[`docs/installer-internals.md`](docs/installer-internals.md#verificación).

## Instalación en Windows (Docker Desktop)

El instalador `install.sh` no corre en Windows. El camino soportado es Docker
Compose: todo (`agy`, Deno, bridge, keyring) corre dentro de contenedores
Linux; el host solo necesita Docker. Guía completa:
[`docs/docker-compose.md`](docs/docker-compose.md).

**1. Cloná y construí:**

```powershell
git clone https://github.com/AlvaroTapia-f/agy-bridge.git
cd agy-bridge
docker compose build
```

**2. Autenticá `agy` (OAuth dueño del CLI oficial) y levantá el servicio:**

```powershell
docker compose run --rm agy-auth
docker compose up -d
```

Seguí los prompts del CLI. Las credenciales quedan en volúmenes Docker con
nombre y se reutilizan entre reinicios. Los archivos con CRLF se normalizan
dentro del contenedor; no edites scripts con editores que fuercen CRLF sin
normalizar.

**3. Obtené el token local del bridge (NO es un token de Google):**

```powershell
docker compose run --rm print-token
```

Formato esperado: `AGY_TOKEN=<48 hex minúsculas>`. Guárdalo como
`$token` para el paso siguiente; nunca lo comitees.

**4. Cableá opencode a mano (provider + plugin + auth):**

a) Copiá el plugin bundleado a tu config de opencode:

```powershell
Copy-Item .\plugins\agy-bridge.ts $HOME\.config\opencode\plugins\agy-bridge.ts -Force
```

b) En `%USERPROFILE%\.config\opencode\opencode.json`, agregá el provider
(`baseURL` **debe** terminar en `/v1`, el SDK añade `/chat/completions`) y el
plugin ([forma exacta](docs/installer-internals.md#provider-opencode-global)):

```json
{
  "provider": {
    "agy-bridge": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "AGY Bridge",
      "options": { "baseURL": "http://127.0.0.1:7421/v1" },
      "models": {
        "auto-ro-gemini-3.1-pro": {
          "id": "auto-ro-gemini-3.1-pro",
          "name": "auto-ro-gemini-3.1-pro",
          "provider": { "id": "agy-bridge", "name": "AGY Bridge" },
          "reasoning": true,
          "interleaved": { "field": "reasoning_content" },
          "reasoning_options": ["high", "low"],
          "variants": {
            "high": { "reasoningEffort": "high" },
            "low": { "reasoningEffort": "low" },
            "medium": { "disabled": true }
          }
        }
        // ... resto de los 14 modelos generados por sync
      }
    }
  },
  "plugin": ["file:///C:/Users/<tu-usuario>/.config/opencode/plugins/agy-bridge.ts"]
}
```

El plugin solo resuelve live; sin `models` en JSON no hay efforts.

Los modelos `auto-ro/rw-*` con `variants` (`reasoningEffort`) se generan con
`deno task sync:models` en Linux; en Windows, si el catálogo cambia, regenerá
el mapa desde una máquina con `deno` + `agy` y copiá el bloque `models`
resultante, o pedí el mapa actualizado al mantenedor. Nunca expongas ids bare
`gemini-*`/`claude-*`.

c) En `%USERPROFILE%\.local\share\opencode\auth.json`, agregá la clave
(preservando las demás):

```json
{ "agy-bridge": { "type": "api", "key": "<AGY_TOKEN>" } }
```

Alternativa manual: `opencode` → `/connect` → `Other` → `agy-bridge` → pegar
`<AGY_TOKEN>`.

**5. Verificá desde PowerShell (usá `curl.exe`, no el alias `curl`):**

```powershell
curl.exe -fsS http://127.0.0.1:7421/healthz
curl.exe -fsS -H "Authorization: Bearer $token" http://127.0.0.1:7421/v1/models
```

Si `healthz` no devuelve `{"ok":true}`, andá a
[Problemas comunes](#problemas-comunes) o a la tabla de troubleshooting
([Compose](docs/docker-compose.md#troubleshooting)).

## Verificación común (ambos OS)

```sh
# 1. Bridge vivo
curl -fsS http://127.0.0.1:7421/healthz        # → {"ok":true}
# En PowerShell: curl.exe -fsS http://127.0.0.1:7421/healthz

# 2. Auth OK (reemplazar <AGY_TOKEN>: en Linux sale de ~/.config/agy-bridge/env,
#    en Windows de `docker compose run --rm print-token`)
curl -fsS -H "Authorization: Bearer <AGY_TOKEN>" http://127.0.0.1:7421/v1/models
```

Checklist extendido (Host guard → `403`, sin auth → `401`, variantes):
[`docs/installer-internals.md`](docs/installer-internals.md#verificación)
(Linux) y [`docs/docker-compose.md`](docs/docker-compose.md#live-acceptance-coverage)
(Docker/Windows).

## Uso diario

- **Elegí modelo por perfil:** `auto-ro-<base>` (solo lectura) o
  `auto-rw-<base>` (lectura/escritura). Cada tarea autónoma = 1 request = 1
  sesión agy (~7.4k tokens de overhead en `ro`, ~9.8k en `rw`). Nunca uses ids
  bare `gemini-*`/`claude-*` en el provider.
- **Variantes de esfuerzo:** cada modelo trae `variants`
  (`high`/`medium`/`low`/`thinking`); si no elegís variante, se aplica
  `medium` → `high` → `low` → `thinking`.
- **Vigilá la cuota:** log append-only en
  `~/.local/state/agy-bridge/usage.jsonl` (Linux) o volumen `bridge-state`
  (Docker). Un JSON por request: fecha, modelo, duración, tokens, estado.
- Catálogo fallback si Antigravity no responde: 7 bases × 2 perfiles = 14 ids
  (verificado en vivo el 2026-09-07).
- **Tras cualquier cambio de catálogo (nuevo modelo o effort), resincronizá
  obligatoriamente:** `deno task sync:models` (`--dry-run` para previsualizar
  sin escribir). El plugin solo resuelve live; los efforts viven en el mapa de
  `opencode.json` que escribe el sync
  ([cómo funciona](docs/installer-internals.md#sincronización-de-modelos)).

Contrato del modelo (forma plana, `reasoning: true`, sin `capabilities`) y
matriz de variantes: [`docs/model-contract.md`](docs/model-contract.md).

## Actualizar

Linux:

1. Actualizá `agy` primero (versiones viejas son rechazadas server-side).
2. Re-corré el instalador (el mismo one-liner de
   [instalación en Linux](#instalación-en-linux-3-pasos)) o `./install.sh`
   desde el repo; esto resincroniza los modelos en vivo y reaplica el parche
   de TUI si hace falta.
3. Solo modelos, sin instalador completo: `deno task sync:models`
   (`--dry-run` para previsualizar sin escribir).

Windows/Docker:

1. Actualizá la imagen fija (`AGY_VERSION` + URL + SHA-512 juntos desde el
   manifest oficial, nunca `curl | sh` sin verificar) y reconstruí:
   `docker compose build --pull --no-cache` + `docker compose up -d --force-recreate`.
2. Nunca uses `docker compose down -v` para actualizar: **borra OAuth,
   keyring, secretos y estado** (solo para reset destructivo total, luego
   re-autenticar con `docker compose run --rm agy-auth`).

Detalle del instalador canónico, bundle del plugin y parche de TUI:
[`docs/installer-internals.md`](docs/installer-internals.md). Ciclo de vida
Docker (start/stop/rebuild/reset):
[`docs/docker-compose.md`](docs/docker-compose.md#normal-lifecycle).

## Desinstalar

Linux:

1. En `~/.config/opencode/opencode.json`, borrá `provider.agy-bridge` y la
   entrada del plugin.
2. En `~/.local/share/opencode/auth.json`, eliminá la clave `agy-bridge`
   (preservando las demás) y dejá el archivo en `chmod 600`.
3. Reiniciá opencode y verificá que ya no aparece el provider.
4. Opcional: detené y deshabilitá el servicio `agy-bridge` de systemd.

Comandos exactos: [`docs/installer-internals.md`](docs/installer-internals.md#rollback).

Windows/Docker:

1. Quitá `provider.agy-bridge`, la entrada del plugin y la clave `agy-bridge`
   de `opencode.json`/`auth.json` como arriba y reiniciá opencode.
2. Detené sin borrar OAuth: `docker compose down` (conserva volúmenes).
3. Solo si querés borrar todo (OAuth + secretos + estado):
   `docker compose down -v`, sabiendo que luego hay que re-autenticar.

## Problemas comunes

| Síntoma | Solución corta |
|---|---|
| `401` en `/v1/models` | Falta el Bearer: `opencode` → `/connect` → `Other` → `agy-bridge` → pegar `<AGY_TOKEN>`; en Linux o re-correr el instalador con `--with-auth`; en Docker re-obtener con `docker compose run --rm print-token` |
| `403` con `Host` raro | Es el guard anti-DNS-rebind: usá `127.0.0.1` o `localhost` como host |
| `404` en `/chat/completions` | El `baseURL` del provider **debe** terminar en `/v1` (el SDK añade `/chat/completions`) |
| `/sdd-model` dice que el modelo no expone effort | El cache del TUI quedó viejo: re-corré `./install.sh` para reaplicar el parche ([por qué](docs/installer-internals.md#parche-del-tui-gentle-ai-effort)) |
| Servicio caído o sin respuesta (Linux) | `systemctl --user status agy-bridge`, luego `journalctl --user -u agy-bridge -f` ([diagnóstico](docs/testing.md#diagnóstico)) |
| Servicio caído o sin respuesta (Docker) | `docker compose ps` y `docker compose logs --no-color --tail 100 agy-bridge` |
| Puerto ocupado | Linux: cambiá `PORT` en `~/.config/agy-bridge/env`. Docker: cambiá solo el lado host (`127.0.0.1:17421:7421`), nunca publiques `7421:7421` sin modelo de seguridad |
| `agy` rechazado o con errores raros | Actualizá `agy` (Linux) o el pin `AGY_VERSION` + URL + SHA-512 juntos (Docker); si cambió flags o el formato `stream-json`, hay que ajustar el parser ([nota](docs/testing.md#diagnóstico)) |
| Modelos desactualizados | `deno task sync:models` (o con `--dry-run` para previsualizar). Obligatorio tras cambios de catálogo: el plugin solo resuelve live |
| `docker compose down -v` borró todo | Esperable: es reset destructivo (config + keyring + secretos + estado). Re-autenticá con `docker compose run --rm agy-auth` |
| En PowerShell, `curl` da flags inválidos | Usá `curl.exe` (el alias `curl` de PowerShell no acepta `-fsS -H`). Equivalente documentado: [`docs/docker-compose.md`](docs/docker-compose.md#powershell-equivalent) |
| Host ARM64 (incl. Apple Silicon) | No soportado por el pin actual (artefacto Linux x64). Actualizar URL + checksum solo tras validar release ARM64 oficial |
| Mapeo `7421:7421` expone a la LAN | Publicá siempre `127.0.0.1:7421:7421` (loopback). Sin el prefijo `127.0.0.1:` el servicio queda visible fuera del host |

Limitaciones conocidas: latencia de arranque del proceso agy por turno
(~2-7s); los thinking tokens se contabilizan en usage pero no se muestran; en
stream los tool-calls se bufferizan (sin deltas); `temperature`/`max_tokens` se
ignoran (agy no los expone).

## Config esencial

Valores por defecto en [`.env.example`](.env.example) (Linux; en Docker los
fija el Compose salvo override explícito):

| Var | Default | Nota |
|---|---|---|
| `PORT` | `7421` | Puerto HTTP |
| `AGY_BIN` | `agy` | Ruta binario `agy` |
| `DENO_BIN` | `deno` | Ruta binario `deno` |
| `AGY_AGENT` | `raw` | Agente por defecto en modo `raw` (opencode usa `auto-*`) |
| `MAX_CONCURRENT` | `1` | Serializa llamadas agy |
| `PRINT_TIMEOUT` | `20m` | `20m` en `.env.example`/`install.sh`; fallback del bridge `15m` si no definido |
| `AGY_TOOLS` | `on` | `off` = desactiva protocolo de tools en `raw` |
| `AGY_TOOL_SCHEMA` | `full` | `slim` = menos tokens en `raw` |
| `AGY_REUSE` | `off` | `on` = continúa conversaciones `raw` (no aplica en `auto-*`) |
| `AGY_TOKEN` | *requerido* | `Authorization: Bearer <AGY_TOKEN>` |

## Para desarrolladores y operadores

- [`docs/architecture.md`](docs/architecture.md) — diagrama, stdin NDJSON
  (`E2BIG`/190 KB), invariantes completas, sesiones y tokens, delegación
  autónoma, protocolo de tools, clasificador de streaming.
- [`docs/model-contract.md`](docs/model-contract.md) — contrato plano del
  modelo (`reasoning: true`, sin `capabilities`), variantes y `reasoningEffort`,
  snapshot 7 bases/14 ids (2026-09-07), ids bare prohibidos.
- [`docs/installer-internals.md`](docs/installer-internals.md) — instalador
  canónico (Linux), instalación manual paso a paso, bundle del plugin
  (`deno task bundle:plugin`), sincronización en 3 niveles, parche del TUI,
  auth sin secretos en repo, verificación completa, rollback.
- [`docs/docker-compose.md`](docs/docker-compose.md) — despliegue Docker
  (Windows/Docker Desktop y Linux x86_64): build, OAuth, token, volúmenes,
  límites de red, verificación determinista y aceptación live.
- [`docs/testing.md`](docs/testing.md) — suite verde (`deno task test`;
  80/80 verificado en vivo el 2026-09-08 — re-verificá con el comando),
  smoke tests, diagnóstico y SDD.
