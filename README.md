# agy-bridge

Puente local **OpenAI-compatible** que expone los modelos de tu suscripción de
Google Antigravity para cualquier cliente (opencode en particular), con una
regla innegociable: **todo el tráfico hacia Google lo realiza el binario
oficial `agy` (CLI de Antigravity) en modo headless, con su propia
autenticación**.

```
opencode ──(OpenAI API)──▶ agy-bridge :7421 ──(spawn+stdin NDJSON)──▶ agy --agent raw …
                                                              │
                                                     cloudcode-pa.googleapis.com
                                              (auth del propio CLI, intacta)
```

El prompt viaja por **stdin** como evento NDJSON del protocolo `stream-json`
de agy (no como argumento de `-p`): los system prompts de opencode superan los
128 KiB que Linux permite por argumento (error `E2BIG` / "Argument list too
long"). Verificado con payloads de ~190 KB.

## Invariantes anti-baneo (no romper)

1. **Solo el binario oficial.** El bridge jamás lee/copiar tokens, no hace
   OAuth propio, no habla con endpoints de Google ni suplanta fingerprints.
2. **Una cuenta, una llamada a la vez** (`MAX_CONCURRENT=1`): los requests se
   encolan y serializan.
3. **Tres agentes según costo/riesgo:**
   - **`raw` — costoso, escape hatch** (~40k tokens por `tool_call`: cada tool de opencode = sesión agy nueva). Solo lectura (`view_file`); su prompt prohíbe usar tools (resiste "ignore previous instructions"). Se mantiene por compatibilidad; no recomendado para tareas largas. `tools: []` cae a "todas" y `wait_5_seconds` rompe la init.
   - **`worker-ro` — autónomo solo lectura** (1 sesión por tarea, sin reenvíos por tool).
   - **`worker-rw` — autónomo lectura/escritura** (puede crear/modificar archivos; nunca `commit`/`push` sin pedido explícito). OJO: `sed_file`, `command_status`, `send_command_input` y `wait_5_seconds` rompen la init si se whitelistan.
4. **Mantén `agy` actualizado** (versiones viejas son rechazadas server-side).
5. Nunca compartas este servicio fuera de localhost (bind 127.0.0.1) ni añadas
   rotación de cuentas.

## Requisitos

Antes de instalar, verifica que tu máquina cumple con esto (el `install.sh` chequea los dos primeros y falla si faltan):

- **Google Antigravity con suscripción activa** y **`agy` CLI instalado y autenticado** (`agy --help` y `agy models` deben funcionar — el bridge solo spawnea `agy`, no hace login por vos).
- **`deno` instalado** (`deno --version` — `install.sh` lo busca en `~/.deno/bin/deno`, `/usr/bin/deno`, etc.).
- **`opencode` instalado** (v1.18+ — si no está `~/.config/opencode/opencode.json`, el installer saltea el provider y avisa).
- **Linux con `systemd --user`** (para `agy-bridge.service` — sin systemd podés correr directo con `deno run`, ver Opción B).
- **`python3`** (para generar `provider.agy-bridge` + modelos `auto-ro/rw-*` con variants en `opencode.json`).
- **`openssl` o `xxd` + `/dev/urandom`** (para generar `AGY_TOKEN` de 24 bytes).
- **Puerto `7421` libre en `127.0.0.1`** (bind loopback — configurable vía `PORT` en `~/.config/agy-bridge/env`).
- **Permisos:** `~/.config/agy-bridge/env` y `~/.local/share/opencode/auth.json` quedan en `chmod 600` automáticamente.

## Instalación

### Opción A: Instalación Automática (Recomendada con systemd)

`install.sh` hace 3 cosas automáticamente:

- **Entorno:** detecta rutas de `deno`/`agy`, inicializa `~/.config/agy-bridge/env` (desde [`.env.example`](.env.example)).
- **Agentes:** copia perfiles `raw`, `worker-ro`, `worker-rw` a `~/.gemini/config/agents/`.
- **Provider + plugin + modelos:** registra provider `agy-bridge` (`baseURL: "http://127.0.0.1:7421/v1"`), instala `~/.config/opencode/plugins/agy-bridge.ts` (+ `agy-bridge-helpers.ts`) y genera modelos `auto-ro/rw-*` con `variants` dinámicos (consulta `GET /v1/models`; fallback agrupado si el bridge no responde).

```sh
./install.sh                 # provider + plugin + modelos (auth manual vía /connect)
./install.sh --with-auth     # + auth.json automático (recomendado para máquina limpia)
```

Flags disponibles:
- `--force`: sobrescribe configuraciones existentes en `~/.gemini/config/agents/`.
- `--with-auth`: configura `~/.local/share/opencode/auth.json` con `AGY_TOKEN` de `~/.config/agy-bridge/env` como `{"agy-bridge":{"type":"api","key":"..."}}`, preservando otras keys, `chmod 600`, idempotente. Sin el flag, la auth es manual vía `/connect` (ver abajo).

### Opción B: Instalación Manual

Si no utilizas systemd o prefieres configurar todo a mano, replica lo que hace `install.sh`:

1. **Configuración de entorno:**
   ```sh
   mkdir -p ~/.config/agy-bridge
   cp .env.example ~/.config/agy-bridge/env
   # Edita ~/.config/agy-bridge/env con tu AGY_TOKEN y rutas de binarios
   chmod 600 ~/.config/agy-bridge/env
   ```

2. **Copiar agentes:**
   ```sh
   mkdir -p ~/.gemini/config/agents
   cp -r agents/* ~/.gemini/config/agents/
   # con --force: sobrescribe existentes
   ```

3. **Instalar plugin de opencode:**
   ```sh
   mkdir -p ~/.config/opencode/plugins
   cp plugins/agy-bridge.ts ~/.config/opencode/plugins/agy-bridge.ts
   cp plugins/agy-bridge-helpers.ts ~/.config/opencode/plugins/agy-bridge-helpers.ts
   ```

4. **Registrar provider y modelos en `~/.config/opencode/opencode.json` (global):**
   Replica lo que hace `install.sh` (ver `plugins/agy-bridge.ts`): añade `provider.agy-bridge` (`npm: "@ai-sdk/openai-compatible"`, `options.baseURL: "http://127.0.0.1:7421/v1"`) y `plugin` con la ruta del plugin. Los modelos `auto-ro/rw-*` se generan agrupando el catálogo de `GET /v1/models` por sufijo de esfuerzo; no exponer ids bare `gemini-*`/`claude-*`.

5. **Configurar auth (elige una):**
   - **Automática (como `--with-auth`):** lee `AGY_TOKEN` de `~/.config/agy-bridge/env` y hace upsert en `~/.local/share/opencode/auth.json` preservando otras keys, `chmod 600`.
   - **Manual:** `opencode` → `/connect` → `Other` → `agy-bridge` → pegar `AGY_TOKEN`. Alternativa env: `"apiKey": "{env:AGY_TOKEN}"` con `source ~/.config/agy-bridge/env` antes de lanzar `opencode`.

6. **Ejecución del servicio:**
   - **Con systemd de usuario:**
     ```sh
     mkdir -p ~/.config/systemd/user
     sed -e "s|\${DENO_BIN}|$(which deno)|g" \
         -e "s|\${AGY_BIN}|$(which agy)|g" \
         -e "s|\${INSTALL_DIR}|$(pwd)|g" \
         agy-bridge.service.template > ~/.config/systemd/user/agy-bridge.service
     systemctl --user daemon-reload
     systemctl --user enable --now agy-bridge
     ```
   - **Directo en terminal (sin systemd):**
     ```sh
     set -a; source ~/.config/agy-bridge/env; set +a
     $DENO_BIN run --allow-net --allow-run=$AGY_BIN \
       --allow-write=$HOME/.local/state/agy-bridge --allow-env agy-bridge.ts
     ```

## OpenCode Provider (global)

El bridge se expone como provider `agy-bridge` en `~/.config/opencode/opencode.json` (solo global, nunca repo-local). `install.sh` lo configura automáticamente; para referencia manual:

```json
{
  "provider": {
    "agy-bridge": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "AGY Bridge",
      "options": { "baseURL": "http://127.0.0.1:7421/v1" }
    }
  },
  "plugin": ["file:///home/<user>/.config/opencode/plugins/agy-bridge.ts"]
}
```

- `baseURL` **debe** terminar en `/v1` — el SDK añade `/chat/completions` (sin `/v1` obtienes `404`).
- `Host` guard en el bridge: solo `127.0.0.1:*` o `localhost:*` → `Host: evil.com` devuelve `403`.
- Plugin (`agy-bridge.ts` + `agy-bridge-helpers.ts`) agrupa el catálogo por sufijo `{-high,-medium,-low,-thinking}` → una entrada base `auto-ro/rw-<base>` con `variants` (ej. `auto-ro-gemini-3.7-flash` → `high/medium/low`). La selección de variante (hook `chat.message` + wrapper `fetch` sobre `7421/v1/chat/completions`) reescribe `model` al wire `auto-ro/rw-<base>-<variant>` validado por `parseAutoModel` en el bridge. Sin variante elegida, el wrapper aplica default `medium` → `high` → `low` → `thinking`; singletons sin variants se envían verbatim. Fallback agrupado actual: 7 bases × 2 perfiles = 14 ids con variants. **Nunca** exponer ids bare `gemini-*`/`claude-*`.

### Auth (sin secretos en repo)

**Automático (recomendado en máquina nueva):** `./install.sh --with-auth` lee `AGY_TOKEN` de `~/.config/agy-bridge/env` y hace upsert en `~/.local/share/opencode/auth.json` preservando otras entradas, `chmod 600`, idempotente. No pisa `opencode-go` ni otras keys.

**Manual (alternativa):** `opencode` → `/connect` → `Other` → `agy-bridge` → pegar `AGY_TOKEN`:

```json
{ "agy-bridge": { "type": "api", "key": "<AGY_TOKEN>" } }
```

`auth.json` y `env` deben ser `chmod 600`. Alternativa: `"apiKey": "{env:AGY_TOKEN}"` con `source ~/.config/agy-bridge/env` antes de lanzar `opencode`. Nunca comitear el token — verifica con `grep -r AGY_TOKEN .` → 0 matches (solo `"{env:AGY_TOKEN}"`).

### Verificación

Checklist post-instalación (endpoints: `GET /v1/models`, `POST /v1/chat/completions`, `GET /healthz`):

```sh
# 1. Bridge vivo y auth OK
source ~/.config/agy-bridge/env
curl -s -H "Authorization: Bearer $AGY_TOKEN" http://127.0.0.1:7421/v1/models | head
curl -s http://127.0.0.1:7421/healthz

# 2. Host guard → 403
curl -s -H "Host: evil.com" -H "Authorization: Bearer $AGY_TOKEN" http://127.0.0.1:7421/v1/models -w " %{http_code}\n"

# 3. Sin auth → 401
curl -s http://127.0.0.1:7421/v1/models -w " %{http_code}\n"

# 4. Provider visible y sin bare ids
opencode models | grep agy-bridge  # solo auto-ro-* y auto-rw-*

# 5. Variante → wire id (picker high envía auto-ro-gemini-3.7-flash-high)
curl -s http://127.0.0.1:7421/v1/chat/completions -H "content-type: application/json" \
  -H "Authorization: Bearer $AGY_TOKEN" \
  -d '{"model":"auto-ro-gemini-3.7-flash-high","messages":[{"role":"user","content":"ping"}]}' | jq .choices[0].message.content
# Stream: añadir "stream":true y usar curl -N
```

### Rollback

```sh
# Quitar provider y auth, reiniciar opencode
# Editar ~/.config/opencode/opencode.json: borrar "provider.agy-bridge" y la entrada de "plugin"
# Borrar clave: jq 'del(.["agy-bridge"])' ~/.local/share/opencode/auth.json > /tmp/a.json && mv /tmp/a.json ~/.local/share/opencode/auth.json && chmod 600 ~/.local/share/opencode/auth.json
# Reiniciar TUI y verificar: opencode models | grep -q agy-bridge && echo "still there" || echo "clean"
```

No hay cambios en `agy-bridge.ts` ni en systemd; `baseURL` loopback y `accessGuard` (Host 403, Bearer 401) permanecen.

## Config (env)

Consulta [`.env.example`](.env.example) para valores por defecto.

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

## Sesiones y tokens: por qué se comporta como se comporta

- **Modo autónomo (`auto-ro/rw`, recomendado): 1 tarea = 1 request = 1 sesión agy.** El modelo resuelve la tarea completa con su loop interno y devuelve un solo completion. Overhead medido: ~7.4k tokens (`ro`) / ~9.8k (`rw`). Reduce ~75/80% de tokens vs modo stateless al evitar reenviar system + schemas + historial por cada tool_call.
- **Modo `raw` (escape hatch, no expuesto en el provider): stateless por turno.** Cada `tool_call` a opencode = sesión agy nueva. Una tarea de 3 pasos ≈ 4 sesiones (3 turnos + metadatos). Composición de un turno `raw` (~40k input): system opencode ~25k, schemas ~12k (→ ~9k con `AGY_TOOL_SCHEMA=slim`), harness ~5.5k + historial. Solo usar vía `curl` directo si necesitas texto puro.
- **Palancas reales de consumo:** (1) tamaño de prompts/skills de opencode, (2) usar `auto-ro/rw` para colapsar N turnos en 1 sesión, (3) `AGY_TOOL_SCHEMA=slim` solo afecta a `raw`. `AGY_REUSE=on` NO ahorra en `raw` (cuesta ~6k más por turno; cache no activa) y es irrelevante en `auto-*`.

## Protocolo de tools

En `raw`, el bridge renderiza tools de opencode como protocolo de texto (`<tool_call>`/`<tool_result>`) y las devuelve como `tool_calls` OpenAI; la ejecución la controla opencode. `AGY_TOOLS=off` degrada a texto puro. En `auto-ro/rw` este protocolo no interviene: el agente ejecuta su loop nativo interno.

## Delegación autónoma (modelos `auto-*`)

Los modelos `auto-<perfil>-` ejecutan un agente agy autónomo que resuelve la tarea completa con su loop nativo y devuelve un solo completion.

```
stateless:  opencode ──n turnos──▶ bridge ──n sesiones──▶ agy raw   (contexto viaja n veces)
auto-ro:    opencode ──1 request──▶ bridge ──1 sesión───▶ agy worker-ro (contexto viaja 1 vez)
```

- **Perfil** = agente con whitelist propia (`~/.gemini/config/agents/`):
  - `ro` → `worker-ro`: `view_file`, `list_dir`, `grep_search`, `find_by_name`, `read_url_content`, `search_web` (~7.4k harness).
  - `rw` → `worker-rw`: `ro` + `write_to_file`, `replace_file_content`, `multi_replace_file_content`, `run_command` (~9.8k harness). No hace `commit`/`push` sin pedido explícito. OJO: `sed_file`, `command_status`, `send_command_input`, `wait_5_seconds` rompen la init.
- **Motor** = cualquier modelo como sufijo (`auto-ro-<modelo>` / `auto-rw-<modelo>`). El provider genera la matriz dinámicamente desde `GET /v1/models` (o fallback 7 bases × 2) y el bridge valida en `parseAutoModel`. Los ids bare stateless fueron removidos del provider; el bridge conserva el path `raw`/bare como escape hatch para API directa.
- Streaming bufferizado + SSE `: keepalive` cada 10s (deltas intermedios no garantizan igualar al final con tools nativas). `delta_chars` se loguea para medición.

## Consumo de cuota (vigilar)

- Log append-only: `~/.local/state/agy-bridge/usage.jsonl` (ts, modelo, duración, tokens, status por request).
- Overhead por tarea autónoma: ~7.4k (`ro`) / ~9.8k (`rw`); ~5.5k en `raw`.

## Diagnóstico rápido

```sh
systemctl --user status agy-bridge
journalctl --user -u agy-bridge -f
tail ~/.local/state/agy-bridge/usage.jsonl
# Smoke test: ver Verificación paso 5 (POST auto-ro-*)
```

Si agy cambia flags/eventos (stream-json), el bridge rompe: revisar `agy --help`, ajustar parser y correr smoke test de Verificación.

## Limitaciones

- Latencia de arranque de proceso agy por turno (~2-7s).
- Thinking tokens: se contabilizan en usage, no se muestran.
- Tool-calls en modo stream se bufferizan (no hay streaming de deltas en turnos con tools).
- `temperature`/`max_tokens` se ignoran (agy no los expone).
