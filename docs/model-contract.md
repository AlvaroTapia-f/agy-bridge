# Contrato del modelo

[← Volver al README](../README.md) · [Arquitectura](architecture.md) ·
[Internals del instalador](installer-internals.md) · [Testing](testing.md)

## Forma plana (sin `capabilities`)

El provider `agy-bridge` publica cada modelo en forma plana: `reasoning: true`
a nivel del modelo + `variants.*.reasoningEffort`, **sin objeto
`capabilities`**. Verificado con `cat ~/.config/opencode/opencode.json | jq`
y suite verde (`deno task test`; 80/80 verificado en vivo el 2026-09-08).

Sin embargo, el SDK `@ai-sdk/openai-compatible` que usa `opencode` enriquece
el modelo y deja `capabilities.reasoning` en `false` (o ausente) en
`api.state.provider` (el que ve el TUI). Por eso existe el parche del TUI —
ver [installer-internals.md](installer-internals.md#parche-del-tui-gentle-ai-effort).

## Variantes por esfuerzo

El plugin (`agy-bridge.ts` + `agy-bridge-helpers.ts`) agrupa el catálogo por
sufijo `{-high,-medium,-low,-thinking}` → una entrada base `auto-ro/rw-<base>`
con `variants` (ej. `auto-ro-gemini-3.7-flash` → `high/medium/low`).

No hay reescritura en el cliente: el wrapper `fetch` sobre
`7421/v1/chat/completions` y el hook `chat.message` fueron eliminados. Cada
ruta de entrada (TUI, directa, subagente, provider SDD) envía el id verbatim
y el bridge verifica con `resolveWireModel` (fail-closed): solo resuelve a
`<base>-<effort>` declarado. El bridge acepta la elección de variante por
cualquiera de estas señales del cuerpo del POST y las pasa todas al
consenso: (1) `reasoning_effort` plano, (2) `reasoning.effort` anidado,
(3) `variant`, (4) el sufijo ya presente en el slug del wire model. Si todas
las señales presentes coinciden, resuelve al slug con sufijo; si conflicto,
bare multi-effort sin señal, o slug desconocido, responde 400 nombrando los
slugs con sufijo disponibles (sin defaults silenciosos). El valor `default`
(opencode sin variante) se trata como señal ausente.

Pin de wire: `opencode` **1.18.29** mapea la elección de `/variant` a la
clave plana `reasoning_effort` en el POST (`request mapper` del binario,
verificado con captura en vivo el 2026-09-09). La variante `thinking` no
existe en el enum `reasoningEffort` de opencode (`none…max`): el mapa la
anuncia como `reasoningEffort: "max"` y el bridge aplica el alias inverso
acotado `max → thinking` solo cuando `thinking` está declarado para esa base.

## Versión del mapa y caché

`MODEL_MAP_VERSION = 3` en `plugins/agy-bridge-helpers.ts` invalida cachés
de variantes aguas abajo: `install.sh` purga la entrada `agy-bridge` de
`~/.gentle-ai/cache/model-variants.json` (ese caché unía genéricos
`{high,low,medium}` en cada fila) y `scripts/sync-models.ts` sella la versión
en su resultado. El bundle generado preserva el mapa declarado byte por byte
(paridad verificada por hash en `plugins/agy-bridge.bundle.test.ts`).

## Snapshot del catálogo y regla de ids

- Fallback agrupado actual (verificado en vivo contra `GET /v1/models` el
  2026-09-07, tras el retiro de `gemini-3.5-flash` aguas arriba): **7 bases ×
  2 perfiles = 14 ids** con variants.
- Cualquier nuevo modelo o esfuerzo de razonamiento expuesto por Antigravity
  (como `high`, `medium`, `low`, `thinking`, `ultra`) se infiere y agrupa
  dinámicamente bajo su base correspondiente (`auto-ro-<base>` /
  `auto-rw-<base>`) con `variants.<effort>.reasoningEffort`.
- **Nunca** exponer ids bare `gemini-*`/`claude-*` en el provider. Los ids bare
  stateless fueron removidos del provider; el bridge conserva el path
  `raw`/bare como escape hatch para API directa.
