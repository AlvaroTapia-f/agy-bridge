# Arquitectura

[← Volver al README](../README.md) · [Contrato del modelo](model-contract.md) ·
[Internals del instalador](installer-internals.md) · [Testing](testing.md)

Puente local **OpenAI-compatible** que expone los modelos de la suscripción de
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

1. **Solo el binario oficial.** El bridge jamás lee/copia tokens, no hace
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

## Sesiones y tokens: por qué se comporta como se comporta

- **Modo autónomo (`auto-ro/rw`, recomendado): 1 tarea = 1 request = 1 sesión agy.** El modelo resuelve la tarea completa con su loop interno y devuelve un solo completion. Overhead medido: ~7.4k tokens (`ro`) / ~9.8k (`rw`). Reduce ~75/80% de tokens vs modo stateless al evitar reenviar system + schemas + historial por cada tool_call.
- **Modo `raw` (escape hatch, no expuesto en el provider): stateless por turno.** Cada `tool_call` a opencode = sesión agy nueva. Una tarea de 3 pasos ≈ 4 sesiones (3 turnos + metadatos). Composición de un turno `raw` (~40k input): system opencode ~25k, schemas ~12k (→ ~9k con `AGY_TOOL_SCHEMA=slim`), harness ~5.5k + historial. Solo usar vía `curl` directo si necesitas texto puro.
- **Palancas reales de consumo:** (1) tamaño de prompts/skills de opencode, (2) usar `auto-ro/rw` para colapsar N turnos en 1 sesión, (3) `AGY_TOOL_SCHEMA=slim` solo afecta a `raw`. `AGY_REUSE=on` NO ahorra en `raw` (cuesta ~6k más por turno; cache no activa) y es irrelevante en `auto-*`.

## Delegación autónoma (modelos `auto-*`)

Los modelos `auto-<perfil>-` ejecutan un agente agy autónomo que resuelve la tarea completa con su loop nativo y devuelve un solo completion.

```
stateless:  opencode ──n turnos──▶ bridge ──n sesiones──▶ agy raw   (contexto viaja n veces)
auto-ro:    opencode ──1 request──▶ bridge ──1 sesión───▶ agy worker-ro (contexto viaja 1 vez)
```

- **Perfil** = agente con whitelist propia (`~/.gemini/config/agents/`):
  - `ro` → `worker-ro`: `view_file`, `list_dir`, `grep_search`, `find_by_name`, `read_url_content`, `search_web` (~7.4k harness).
  - `rw` → `worker-rw`: `ro` + `write_to_file`, `replace_file_content`, `multi_replace_file_content`, `run_command` (~9.8k harness). No hace `commit`/`push` sin pedido explícito. OJO: `sed_file`, `command_status`, `send_command_input`, `wait_5_seconds` rompen la init.
- **Motor** = cualquier modelo como sufijo (`auto-ro-<modelo>` / `auto-rw-<modelo>`). El provider genera la matriz dinámicamente desde `GET /v1/models` (o fallback 7 bases × 2 = 14 ids, verificado en vivo 2026-09-07) y el bridge valida en `parseAutoModel`. Los ids bare stateless fueron removidos del provider; el bridge conserva el path `raw`/bare como escape hatch para API directa. Detalle del contrato en [model-contract.md](model-contract.md).
- **Streaming incremental con clasificador de narración** (`NOTE:` → `reasoning_content`, respuesta final → `content`) + SSE `: keepalive` cada 10s durante la ejecución de herramientas internas. `delta_chars` se loguea para medición.

## Protocolo de tools

En `raw`, el bridge renderiza tools de opencode como protocolo de texto (`<tool_call>`/`<tool_result>`) y las devuelve como `tool_calls` OpenAI; la ejecución la controla opencode. `AGY_TOOLS=off` degrada a texto puro. En `auto-ro/rw` este protocolo no interviene: el agente ejecuta su loop nativo interno.

## Consumo de cuota (vigilar)

- Log append-only: `~/.local/state/agy-bridge/usage.jsonl` (ts, modelo, duración, tokens, status por request).
- Overhead por tarea autónoma: ~7.4k (`ro`) / ~9.8k (`rw`); ~5.5k en `raw`.
