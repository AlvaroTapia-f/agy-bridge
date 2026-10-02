# Contrato del modelo

[← Volver al README](../README.md) · [Arquitectura](architecture.md) ·
[Internals del instalador](installer-internals.md) · [Testing](testing.md)

## Dual: V1 (mapa estático) vs V2 (catálogo del plugin)

El bridge expone el mismo catálogo en los dos runtimes, pero **el dueño del
catálogo cambia según la versión de opencode**. Esto no es cosmético: define
dónde hay que tocar cuando el catálogo cambia.

| | OpenCode V1 | OpenCode V2 |
|---|---|---|
| Dueño del catálogo | `scripts/sync-models.ts` escribe `provider.agy-bridge.models` en `opencode.json` | El plugin: `ctx.provider.transform` + `ctx.provider.reload()` |
| Estático en JSON | Sí — el mapa de 14 ids vive en el config | **No** — V2 config no lleva `models` |
| Esfuerzos (efforts) | `variants.<effort>.reasoningEffort` dentro del mapa del config | `variants[].settings.reasoningEffort` dentro de cada `Model.Info` |
| Roles de plugin | `agy-bridge.ts` (export default función, `@opencode-ai/plugin`) | `agy-bridge.v2.ts` (`Plugin.define`, `@opencode/plugin`) |
| Bundle | `plugins/agy-bridge.ts` | `plugins/agy-bridge.v2.bundle.ts` |
| Forma del provider en config | `provider.agy-bridge` (singular) + `npm` + `options.baseURL` | `providers.agy-bridge` (plural) + `package` + `settings.baseURL` |
| Auth | `/connect` → `Other` → `type: "api"` | `POST /api/integration/<id>/connect/key` |

**Por qué V2 no lleva `models` en el JSON.** En V1 el mapa estático era la
única forma de que el TUI mostrara los esfuerzos: sin `variants` en el config,
el picker aparecía vacío. En V2 el plugin es la única fuente de la verdad del
catálogo, y un `models` en el config sería una **segunda copia congelada** que
nadie refresca: en cuanto el bridge agrega o quita un modelo, el usuario vería
un lista distinta según cuál de las dos copias leyera el runtime. Peor: el
plugin refresca con `ctx.provider.reload()` cada `refreshIntervalMs`, así que
las dos copias divergirían de forma silenciosa. Por eso `install.sh` en modo V2
escribe `providers.agy-bridge` **sin** `models` ([detalle en
installer-internals](installer-internals.md#provider-opencode-global)).

`tests/plugin-smoke-v2.sh` es el gate que verifica esta separación: si el
catálogo alguna vez dejara de salir del plugin, los asserts de variantes
fallan.

## Forma del modelo en V2 (medido contra opencode v2.0.20)

Verificado contra el runtime real, no contra la doc. Cada `Model.Info` que
emite `buildModelV2` en `plugins/agy-bridge-helpers.ts` **debe** llevar:

```json
{
  "id": "auto-ro-gemini-3.7-flash",
  "modelID": "auto-ro-gemini-3.7-flash",
  "providerID": "agy-bridge",
  "name": "auto-ro-gemini-3.7-flash",
  "enabled": true,
  "status": "active",
  "time": { "released": 0 },
  "cost": [],
  "capabilities": { "tools": true, "input": ["text", "image"], "output": ["text"] },
  "limit": { "context": 200000, "output": 32000 },
  "compatibility": { "reasoningField": "reasoning_content" },
  "variants": [
    { "id": "high",   "settings": { "reasoningEffort": "high" } },
    { "id": "medium", "settings": { "reasoningEffort": "medium" } },
    { "id": "low",    "settings": { "reasoningEffort": "low" } }
  ]
}
```

- `time.released`, `cost` y `status` son **obligatorios** en V2. Omitirlos no
  da error de validación en el `setup()`: el error aparece después, cuando el
  runtime lee el catálogo, y rompe el endpoint de modelos entero con
  `TypeError: undefined is not an object (evaluating '$H.time.released')`.
  Es una rotura silenciosa — el plugin figura `active` y no hay modelos.
- `compatibility.reasoningField` sí existe en V2 y se respeta: es el reemplazo
  de `interleaved.field` de V1. El tipo es un string abierto
  (`"reasoning" | "reasoning_content" | "reasoning_text" | (string & {})`).
- `capabilities` y `limit` se aceptan y se sirven tal cual.
- `settings.reasoningEffort` **dentro de la variante** es la señal que el picker
  usa; el valor `"max"` es válido (el enum de V2 es
  `none…minimal, low, medium, high, xhigh, max`).

### Por qué la doc sola no alcanza (y por qué hay smoke)

Estas formas se midieron contra `opencode v2.0.20`, no deducidas de la
documentación. La primera versión del bundle **no cumplía** nada de esto y
fallaba en silencio: el método de auth usaba la forma de V1
(`{id: "api", type: "api-key"}` en vez de `{type: "key"}`), lo que hacía que el
schema lanzara dentro de `setup()` y los transforms de provider y modelo nunca
se registraran; y a cada `Model.Info` le faltaban `time`, `cost` y `status`, lo
que rompía `GET /api/model` con un 500 opaco al ordenar el catálogo.

Los dos eran silenciosos, y los dos se colaron porque los stubs locales de
`stubs/opencode-plugin-v2.ts` eran permisivos: el type-check pasaba y el fallo
aparecía recién en runtime. Por eso el stub ahora es estricto y el smoke es un
gate obligatorio:

```bash
bash tests/plugin-smoke-v2.sh
```

Levanta un `opencode serve` privado por caso, en su propio puerto, con `XDG_*`
y `TMPDIR` relocalizados, y verifica contra el runtime real que el plugin queda
`active`, que `/api/model` sirve los 14 modelos, y que **cada variante llega con
su `reasoningEffort` intacto** —que es justamente lo que V1 perdía en
silencio— más `compatibility.reasoningField`, `capabilities` y `limit`. También
cubre el bridge caído (el catálogo de fallback tiene que seguir saliendo) y
verifica que el `opencode.json` real del usuario queda intacto.

Estado actual: **19/19 checks verdes** contra `opencode v2.0.20`.

## Forma plana (sin `capabilities`) — solo V1

El provider `agy-bridge` publica cada modelo en forma plana: `reasoning: true`
a nivel del modelo + `variants.*.reasoningEffort`, **sin objeto
`capabilities`**. Verificado con `cat ~/.config/opencode/opencode.json | jq`
y suite verde (`deno task test`; 80/80 verificado en vivo el 2026-09-08).

> Esto es **solo V1**. En V2 el modelo lleva `capabilities` explícito
> (`tools`/`input`/`output`) porque `Model.Info` lo declara como campo
> requerido. Ver [Forma del modelo en V2](#forma-del-modelo-en-v2-medido-contra-opencode-v2020).

Sin embargo, el SDK `@ai-sdk/openai-compatible` que usa `opencode` enriquece
el modelo y deja `capabilities.reasoning` en `false` (o ausente) en
`api.state.provider` (el que ve el TUI). Por eso existe el parche del TUI —
ver [installer-internals.md](installer-internals.md#parche-del-tui-gentle-ai-effort).

## Variantes por esfuerzo

### En V2 el mapa estático ya no aplica

El "effort masking" de abajo (entradas `{disabled: true}`, `reasoning_options`,
el parche del TUI sobre `model-variants.json`) es una defensa de **V1**: en V1
el runtime fusionaba efforts genéricos `{high, low, medium}` sobre el mapa, y
había que taparlos. En V2 no hay fusión: `Model.Info.variants` es exactamente la
lista que emite el plugin, y el plugin la vuelve a filtrar en cada
`ctx.model.transform` con `filterUndeclaredVariants` + `ctx.model.reload()`.
Por eso la purga de `model-variants.json` está **gateada a V1** en `install.sh`,
y por eso en V2 no se escribe `reasoning_options` ni `{disabled: true}`.

### V1

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

`MODEL_MAP_VERSION = 4` en `plugins/agy-bridge-helpers.ts` invalida cachés
de variantes aguas abajo: `install.sh` purga la entrada `agy-bridge` de
`~/.gentle-ai/cache/model-variants.json` (ese caché unía genéricos
`{high,low,medium}` en cada fila) y `scripts/sync-models.ts` sella la versión
en su resultado. El bundle generado preserva el mapa enmascarado byte por byte
(paridad verificada por hash en `plugins/agy-bridge.bundle.test.ts`).
Detalle del enmascarado en la sección en inglés
[Effort masking contract](#effort-masking-contract-model-map-v4).

## Effort masking contract (model map v4)

Every reasoning model pre-populates the full generic effort set so the
runtime merge cannot introduce unmasked entries:

- `GENERIC_EFFORTS = ["high", "medium", "low"]` in
  `plugins/agy-bridge-helpers.ts`. `thinking` is agy-specific and is never
  injected by the runtime, so it stays out of the set.
- Declared efforts (slug-suffix truth) stay enabled as
  `{reasoningEffort}`. `thinking` is advertised as `reasoningEffort: "max"`
  (opencode has no `thinking` in its enum) and the bridge maps `max →
  thinking` back only when `thinking` is declared for that base.
- Generic-but-undeclared efforts are emitted as exactly
  `{disabled: true}` — no `reasoningEffort` alongside it.
- Each reasoning model also carries
  `reasoning_options: [...declared].sort()`, the machine-readable
  declared truth for the downstream filter. Singletons (no variants) are
  untouched: no masking, no `reasoning_options`.

Worked example — `auto-ro-gemini-3.1-pro` declares only `high`/`low`:

```json
{
  "high": { "reasoningEffort": "high" },
  "low": { "reasoningEffort": "low" },
  "medium": { "disabled": true },
  "reasoning_options": ["high", "low"]
}
```

Downstream, the global `~/.config/opencode/plugins/model-variants.ts`
cache-writer (patched by `install.sh`, marker `agy-bridge-mask-v1`) drops
every `{disabled: true}` entry, intersects the survivors with
`reasoning_options` when present, and skips the row when nothing remains
(fail-closed: no effort beats a wrong effort). The TUI picker therefore
shows only declared efforts, every offered pick resolves with 200, and
`resolveWireModel` keeps its 400 on truly unknown variants as safety net.

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
