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

| Necesitás | Detalle |
|---|---|
| Suscripción de Google Antigravity + `agy` CLI instalado y autenticado | `agy --help` y `agy models` deben funcionar (el bridge solo spawnea `agy`, no hace login por vos) |
| `deno` (v2.9.5+) | **Prerrequisito estricto**, también para la sincronización de modelos (`deno --version`; buscado en `PATH` y rutas estándar) |
| `opencode` (v1.18+) | Si no existe `~/.config/opencode/opencode.json`, el instalador saltea el provider y avisa |
| Linux con `systemd --user` | Para `agy-bridge.service`; sin systemd podés correr directo con `deno run` ([ver internals](docs/installer-internals.md#opción-c-instalación-manual)) |
| `python3` | Solo para la configuración base de provider/auth en `opencode.json` y el parche de TUI |
| `openssl` o `xxd` + `/dev/urandom` | Para generar el `AGY_TOKEN` de 24 bytes |
| Puerto `7421` libre en `127.0.0.1` | Bind loopback; configurable vía `PORT` en `~/.config/agy-bridge/env` |

`~/.config/agy-bridge/env` y `~/.local/share/opencode/auth.json` quedan en
`chmod 600` automáticamente.

## Instalación en 3 pasos

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

## Uso diario

- **Elegí modelo por perfil:** `auto-ro-<base>` (solo lectura) o
  `auto-rw-<base>` (lectura/escritura). Cada tarea autónoma = 1 request = 1
  sesión agy (~7.4k tokens de overhead en `ro`, ~9.8k en `rw`). Nunca uses ids
  bare `gemini-*`/`claude-*` en el provider.
- **Variantes de esfuerzo:** cada modelo trae `variants`
  (`high`/`medium`/`low`/`thinking`); si no elegís variante, se aplica
  `medium` → `high` → `low` → `thinking`.
- **Vigilá la cuota:** log append-only en
  `~/.local/state/agy-bridge/usage.jsonl` (un JSON por request: fecha, modelo,
  duración, tokens, estado).
- Catálogo fallback si Antigravity no responde: 7 bases × 2 perfiles = 14 ids
  (verificado en vivo el 2026-09-07). Resincronizar en cualquier momento:
  `deno task sync:models` ([cómo funciona](docs/installer-internals.md#sincronización-de-modelos)).

Contrato del modelo (forma plana, `reasoning: true`, sin `capabilities`) y
matriz de variantes: [`docs/model-contract.md`](docs/model-contract.md).

## Actualizar

1. Actualizá `agy` primero (versiones viejas son rechazadas server-side).
2. Re-corré el instalador (el mismo one-liner de
   [instalación](#instalación-en-3-pasos)) o `./install.sh` desde el repo; esto
   resincroniza los modelos en vivo y reaplica el parche de TUI si hace falta.
3. Solo modelos, sin instalador completo: `deno task sync:models`
   (`--dry-run` para previsualizar sin escribir).

Detalle del instalador canónico, bundle del plugin y parche de TUI:
[`docs/installer-internals.md`](docs/installer-internals.md).

## Desinstalar

1. En `~/.config/opencode/opencode.json`, borrá `provider.agy-bridge` y la
   entrada del plugin.
2. En `~/.local/share/opencode/auth.json`, eliminá la clave `agy-bridge`
   (preservando las demás) y dejá el archivo en `chmod 600`.
3. Reiniciá opencode y verificá que ya no aparece el provider.
4. Opcional: detené y deshabilitá el servicio `agy-bridge` de systemd.

Comandos exactos: [`docs/installer-internals.md`](docs/installer-internals.md#rollback).

## Problemas comunes

| Síntoma | Solución corta |
|---|---|
| `401` en `/v1/models` | Falta el Bearer: `opencode` → `/connect` → `Other` → `agy-bridge` → pegar `AGY_TOKEN`, o re-correr el instalador con `--with-auth` |
| `403` con `Host` raro | Es el guard anti-DNS-rebind: usá `127.0.0.1` o `localhost` como host |
| `404` en `/chat/completions` | El `baseURL` del provider **debe** terminar en `/v1` (el SDK añade `/chat/completions`) |
| `/sdd-model` dice que el modelo no expone effort | El cache del TUI quedó viejo: re-corré `./install.sh` para reaplicar el parche ([por qué](docs/installer-internals.md#parche-del-tui-gentle-ai-effort)) |
| Servicio caído o sin respuesta | `systemctl --user status agy-bridge`, luego `journalctl --user -u agy-bridge -f` ([diagnóstico](docs/testing.md#diagnóstico)) |
| Puerto ocupado | Cambiá `PORT` en `~/.config/agy-bridge/env` |
| `agy` rechazado o con errores raros | Actualizá `agy`; si cambió flags o el formato `stream-json`, hay que ajustar el parser ([nota](docs/testing.md#diagnóstico)) |
| Modelos desactualizados | `deno task sync:models` (o con `--dry-run` para previsualizar) |

Limitaciones conocidas: latencia de arranque del proceso agy por turno
(~2-7s); los thinking tokens se contabilizan en usage pero no se muestran; en
stream los tool-calls se bufferizan (sin deltas); `temperature`/`max_tokens` se
ignoran (agy no los expone).

## Config esencial

Valores por defecto en [`.env.example`](.env.example):

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
  canónico, instalación manual paso a paso, bundle del plugin
  (`deno task bundle:plugin`), sincronización en 3 niveles, parche del TUI,
  auth sin secretos en repo, verificación completa, rollback.
- [`docs/testing.md`](docs/testing.md) — suite verde (`deno task test`;
  80/80 verificado en vivo el 2026-09-08 — re-verificá con el comando),
  smoke tests, diagnóstico y SDD.
