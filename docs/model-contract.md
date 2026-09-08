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

La selección de variante (hook `chat.message` + wrapper `fetch` sobre
`7421/v1/chat/completions`) reescribe `model` al wire
`auto-ro/rw-<base>-<variant>` validado por `parseAutoModel` en el bridge. Sin
variante elegida, el wrapper aplica default `medium` → `high` → `low` →
`thinking`; singletons sin variants se envían verbatim.

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
