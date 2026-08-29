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
3. **Agente `raw` con whitelist de una sola tool de solo lectura**
   (`~/.gemini/config/agents/raw/agent.md`, `tools: [view_file]`): aunque el
   modelo intente actuar, el peor caso es leer un archivo. El prompt del agente
   además le prohíbe usar tools (verificado: resiste "ignore previous
   instructions"). Esto es necesario porque `settings.json` de agy tiene
   `toolPermission: always-proceed`.
   - Hallazgo de Fase 0: `tools: []` cae a "todas las tools" y
     `tools: [wait_5_seconds]` rompe la inicialización del agente;
     `init.tools` del stream muestra el catálogo completo (cosmético) — la
     restricción real es la whitelist.
4. **Mantén `agy` actualizado** (versiones viejas de cliente son rechazadas
   server-side).
5. Nunca compartas este servicio fuera de localhost (bind 127.0.0.1) ni añadas
   rotación de cuentas.

## Instalación

### Opción A: Instalación Automática (Recomendada con systemd)

El script [`install.sh`](install.sh) detecta automáticamente las rutas de `deno` y `agy`, inicializa la configuración en `~/.config/agy-bridge/env` (basada en [`.env.example`](.env.example)), copia los perfiles de agentes requeridos (`agents/`) y registra/inicia el servicio systemd de usuario:

```sh
./install.sh                 # solo provider + plugin + modelos
./install.sh --with-auth     # + auth.json automático (recomendado para máquina limpia)
```

Flags disponibles:
- `--force`: Sobrescribe configuraciones de agentes existentes en `~/.gemini/config/agents/`.
- `--with-auth`: Configura `~/.local/share/opencode/auth.json` con `AGY_TOKEN` de `~/.config/agy-bridge/env` como `{"agy-bridge":{"type":"api","key":"..."}}`, preservando otras keys (`opencode-go` etc.), `chmod 600`, idempotente. Sin el flag, la auth se hace manual vía `/connect` (ver abajo).

### Opción B: Instalación Manual

Si no utilizas systemd o prefieres configurar todo a mano:

1. **Configuración de entorno:**
   Copia `.env.example` a `~/.config/agy-bridge/env`:
   ```sh
   mkdir -p ~/.config/agy-bridge
   cp .env.example ~/.config/agy-bridge/env
   # Edita ~/.config/agy-bridge/env con tu AGY_TOKEN y rutas de binarios
   chmod 600 ~/.config/agy-bridge/env
   ```

2. **Copiar agentes:**
   Los perfiles de agentes (`raw`, `worker-ro`, `worker-rw`) deben estar en `~/.gemini/config/agents/`:
   ```sh
   mkdir -p ~/.gemini/config/agents
   cp -r agents/* ~/.gemini/config/agents/
   ```

3. **Ejecución del servicio:**
   - **Con systemd de usuario:**
     Renderiza `agy-bridge.service.template` en `~/.config/systemd/user/agy-bridge.service`:
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
     Exporta las variables de entorno necesarias y ejecuta Deno directamente:
     ```sh
     set -a; source ~/.config/agy-bridge/env; set +a
     $DENO_BIN run --allow-net --allow-run=$AGY_BIN \
       --allow-write=$HOME/.local/state/agy-bridge --allow-env agy-bridge.ts
     ```

## OpenCode Provider (global)

El bridge se expone como provider `agy-bridge` en `~/.config/opencode/opencode.json` (solo global, nunca repo-local). `install.sh` lo configura automáticamente (provider + plugin `~/.config/opencode/plugins/agy-bridge.ts` + 14 modelos `auto-ro/rw-*` con `variants`). Con `--with-auth` también configura `auth.json` sin pasos manuales; para instalación manual:

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
- Plugin `~/.config/opencode/plugins/agy-bridge.ts` agrupa modelos por sufijo `{-high,-medium,-low,-thinking}` → una entrada base `auto-ro/rw-<base>` con `variants: {high,medium,low}` (ej. `auto-ro-gemini-3.7-flash` → picker `high/medium/low`; singletons `claude-sonnet-4-6` → `variants:{}`). Seleccionar variante (vía hook `chat.message`) reescribe `model` al wire `auto-ro-<base>-<variant>` validado por `parseAutoModel` en el bridge. Sin variante elegida, defaultea a `medium`/`high` si el modelo tiene variants; singletons sin variants se envían verbatim. **Nunca** se exponen ids bare `gemini-*`/`claude-*`.

### Auth (sin secretos en repo)

**Automático (recomendado en máquina nueva):** `./install.sh --with-auth` lee `AGY_TOKEN` de `~/.config/agy-bridge/env` y hace upsert en `~/.local/share/opencode/auth.json` preservando otras entradas, `chmod 600`, idempotente. No pisa `opencode-go` ni otras keys.

**Manual (alternativa):** `opencode` → `/connect` → `Other` → `agy-bridge` → pegar `AGY_TOKEN` de `~/.config/agy-bridge/env`. Esto escribe `~/.local/share/opencode/auth.json`:

```json
{ "agy-bridge": { "type": "api", "key": "<AGY_TOKEN>" } }
```

`auth.json` y `env` deben ser `chmod 600` (el instalador ya lo hace). Alternativa documentada: `"apiKey": "{env:AGY_TOKEN}"` con `source ~/.config/agy-bridge/env` antes de lanzar `opencode`. Nunca comitear el token literal — verifica con `grep -r AGY_TOKEN .` → 0 matches (solo referencias a `"{env:AGY_TOKEN}"`).

### Verificación

```sh
# 1. Bridge vivo y auth OK
source ~/.config/agy-bridge/env
curl -s -H "Authorization: Bearer $AGY_TOKEN" http://127.0.0.1:7421/v1/models | head

# 2. Host guard
curl -s -H "Host: evil.com" -H "Authorization: Bearer $AGY_TOKEN" http://127.0.0.1:7421/v1/models -w " %{http_code}\n"

# 3. Sin auth → 401
curl -s http://127.0.0.1:7421/v1/models -w " %{http_code}\n"

# 4. Provider visible y sin bare ids
opencode models | grep agy-bridge  # debe mostrar solo agy-bridge/auto-ro-* y auto-rw-*

# 5. Variante → wire id (picker high en TUI envía auto-ro-gemini-3.7-flash-high)
curl -s http://127.0.0.1:7421/v1/chat/completions -H "content-type: application/json" \
  -H "Authorization: Bearer $AGY_TOKEN" \
  -d '{"model":"auto-ro-gemini-3.7-flash-high","messages":[{"role":"user","content":"ping"}]}' | jq .choices[0].message.content

# Stream
curl -N http://127.0.0.1:7421/v1/chat/completions -H "content-type: application/json" \
  -H "Authorization: Bearer $AGY_TOKEN" \
  -d '{"model":"auto-ro-gemini-3.7-flash-high","messages":[{"role":"user","content":"ping"}],"stream":true}'
```

### Rollback

```sh
# Quitar provider y auth, reiniciar opencode
# Editar ~/.config/opencode/opencode.json: borrar "provider.agy-bridge" y la entrada de "plugin"
# Borrar clave: jq 'del(.["agy-bridge"])' ~/.local/share/opencode/auth.json > /tmp/a.json && mv /tmp/a.json ~/.local/share/opencode/auth.json && chmod 600 ~/.local/share/opencode/auth.json
# Reiniciar TUI y verificar: opencode models | grep -q agy-bridge && echo "still there" || echo "clean"
```

No hay cambios en `agy-bridge.ts` ni en systemd; `baseURL` loopback y `accessGuard` (Host 403, Bearer 401) permanecen.

## Uso

```sh
# Verificar estado
curl -s http://127.0.0.1:7421/healthz
```

Endpoints: `GET /v1/models`, `POST /v1/chat/completions` (stream y no-stream), `GET /healthz`.

## Config (env)

Consulta [`.env.example`](.env.example) para ver la lista completa con valores por defecto.

| Var | Default | Nota |
|---|---|---|
| `PORT` | `7421` | Puerto del servidor HTTP |
| `AGY_BIN` | `agy` | Ruta al binario oficial `agy` |
| `DENO_BIN` | `deno` | Ruta al binario `deno` (usado por `install.sh`/systemd) |
| `AGY_AGENT` | `raw` | Agente de agy sin tools |
| `MAX_CONCURRENT` | `1` | Serializa llamadas agy |
| `PRINT_TIMEOUT` | `15m` | `--print-timeout` de agy |
| `AGY_TOOLS` | `on` | `off` = desactiva el protocolo de tools (texto puro) |
| `AGY_TOOL_SCHEMA` | `full` | `slim` quita descripciones de parámetros: −2.7k tokens/turno (medido), pequeño riesgo de peores tool calls |
| `AGY_REUSE` | `off` | `on` = continúa conversaciones agy entre turnos (1 sesión por tarea en vez de 1 por turno), PERO cuesta ~6k tokens MÁS por turno (agy reprocesa todo + reininyecta harness; el cache nunca activa — medido). Solo si te molestan las sesiones y prefieres pagar tokens |
| `AGY_TOKEN` | *requerido* | Token secreto de autenticación (`Authorization: Bearer <AGY_TOKEN>`) |

## Sesiones y tokens: por qué se comporta como se comporta

- **Una sesión agy por completion** es inherente al modelo OpenAI-compatible
  (stateless): opencode reenvía system + tools + historial en cada turno. Una
  tarea de 3 pasos = 3 turnos + 1 llamada pequeña de metadatos/título de
  opencode ≈ las 4 sesiones que ves.
- **Composición medida de un turno real de subagente sdd (~40k tokens de
  input)**: system de opencode ~25k (prompt del agente + AGENTS.md + skills —
  la parte dominante, se controla desde tu config de opencode), schemas de
  tools ~12k (→ ~9k con `AGY_TOOL_SCHEMA=slim`), harness de agy ~5.5k
  (fijo, no configurable), historial (crece con la tarea).
- **Palancas reales de consumo**: (1) el tamaño de tus prompts/skills de
  subagente, (2) menos turnos por tarea (prompts que pidan respuestas
  directas), (3) `slim`, en ese orden. `AGY_REUSE` NO ahorra tokens.

## Protocolo de tools

opencode pasa sus tools (bash, edit, read…) en cada request; el bridge las
renderiza como protocolo de texto (`<tool_call>{json}</tool_call>` /
`<tool_result>`), parsea la respuesta del modelo y las devuelve como
`tool_calls` OpenAI. **La ejecución la controla opencode con sus permisos**
(tus reglas ask de git siguen aplicando), no agy. Si algún modelo flashea con
el protocolo, `AGY_TOOLS=off` degrada a modo texto.

## Delegación autónoma (modelos `auto-*`)

Los modelos con prefijo `auto-<perfil>-` cambian el modo de operación: en vez
de comportarse como endpoint stateless (un turno opencode = una sesión agy),
ejecutan **un agente agy autónomo** que resuelve la tarea completa con su
propio loop nativo de tools y devuelve un solo completion.

```
stateless:  opencode ──n turnos──▶ bridge ──n sesiones──▶ agy raw   (contexto viaja n veces)
auto-ro:    opencode ──1 request──▶ bridge ──1 sesión───▶ agy worker-ro (loop interno; contexto viaja 1 vez)
```

- **Perfil** = agente agy con whitelist propia (`~/.gemini/config/agents/`).
  - `ro` → `worker-ro` (solo lectura: view_file, list_dir, grep_search,
    find_by_name, read_url_content, search_web). Harness medido: ~7.4k tokens.
  - `rw` → `worker-rw` (ro + write_to_file, replace_file_content,
    multi_replace_file_content, run_command). Harness medido: ~9.8k tokens.
    Instrucciones internas prohiben commit/push sin pedido explícito; los
    cambios quedan sin commitear para revisión humana. OJO: `sed_file`,
    `command_status`, `send_command_input` y `wait_5_seconds` rompen la
    inicialización del agente si se whitelistan — no agregarlos.
- **Motor** = cualquier modelo del catálogo como sufijo (`auto-ro-<modelo>` /
  `auto-rw-<modelo>`). La matriz completa 14×2 está registrada en opencode.json
  y el bridge la mapea dinámicamente (valida el sufijo contra `modelSlugs`).
  Los modelos planos stateless fueron REMOVIDOS del provider de opencode
  (ningún agente puede seleccionarlos); el bridge conserva el path raw como
  escape hatch para llamadas API directas.
- Streaming: bufferizado + comentarios SSE `: keepalive` cada 10s (los deltas
  de pasos intermedios NO garantizan igualar al resultado final cuando hay
  tools nativas de por medio). `delta_chars` se loguea para futura medición.
- Una tarea delegada = 1 sesión agy (vs 3-6 sesiones stateless), −75/80%
  tokens medidos en pilotos internos.

## Consumo de cuota (vigilar)

- Log append-only: `~/.local/state/agy-bridge/usage.jsonl`
  (ts, modelo, duración, tokens, status por request).
- **Overhead del harness: ~5.5k tokens de input por llamada** (system prompt
  interno de agy), se suman a tu workload de la ventana de 5h.
- Cada completion = conversación agy nueva → el contexto se reprocesa por
  turno (limitación conocida; mitigación futura: reusar `conversation_id`).

## Diagnóstico rápido

```sh
systemctl --user status agy-bridge      # servicio
journalctl --user -u agy-bridge -f      # logs del bridge
tail ~/.local/state/agy-bridge/usage.jsonl
# smoke test completo:
curl -s http://127.0.0.1:7421/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"gemini-3.7-flash-low","messages":[{"role":"user","content":"ping"}]}'
```

Si agy cambia flags/eventos (stream-json), el bridge rompe: revisar
`agy --help`, ajustar parser, y correr el smoke test de arriba.

## Limitaciones

- Latencia de arranque de proceso agy por turno (~2-7s).
- Thinking tokens: se contabilizan en usage, no se muestran.
- Tool-calls en modo stream se bufferizan (no hay streaming de deltas en turnos
  con tools).
- `temperature`/`max_tokens` se ignoran (agy no los expone).
