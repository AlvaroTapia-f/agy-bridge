# Internals del instalador

[← Volver al README](../README.md) · [Arquitectura](architecture.md) ·
[Contrato del modelo](model-contract.md) · [Testing](testing.md)

`install.sh` es el instalador canónico del proyecto. Realiza la configuración
localmente:

- **Entorno:** detecta rutas de `deno`/`agy`, inicializa `~/.config/agy-bridge/env` (desde [`.env.example`](../.env.example)).
- **Agentes:** copia perfiles `raw`, `worker-ro`, `worker-rw` a `~/.gemini/config/agents/`.
- **Provider + plugin + modelos:** registra provider `agy-bridge` (`baseURL: "http://127.0.0.1:7421/v1"`), instala `~/.config/opencode/plugins/agy-bridge.ts` y sincroniza en vivo los modelos `auto-ro/rw-*` con `variants` dinámicos delegando en `scripts/sync-models.ts` (resolución en 3 niveles: `agy models` TSV → `GET /v1/models` → fallback agrupado).

```sh
./install.sh                 # provider + plugin + sincronización de modelos (auth manual vía /connect)
/install.sh --with-auth     # + auth.json automático (recomendado para máquina limpia)
```

Flags disponibles:

- `--force`: sobrescribe configuraciones existentes en `~/.gemini/config/agents/`.
- `--with-auth`: configura `~/.local/share/opencode/auth.json` con `AGY_TOKEN` de `~/.config/agy-bridge/env` como `{"agy-bridge":{"type":"api","key":"..."}}`, preservando otras keys, `chmod 600`, idempotente. Sin el flag, la auth es manual vía `/connect` (ver [Auth](#auth-sin-secretos-en-repo)).

## Opción A: One-Liner Remoto

Descarga el repositorio de forma segura y delega la ejecución en el instalador canónico `install.sh`:

```sh
# Instalación estándar (auth manual vía /connect)
curl -fsSL https://raw.githubusercontent.com/AlvaroTapia-f/agy-bridge/main/install-remote.sh | bash

# Con configuración automática de auth.json (recomendado para máquina limpia)
curl -fsSL https://raw.githubusercontent.com/AlvaroTapia-f/agy-bridge/main/install-remote.sh | bash -s -- --with-auth
```

> **Auditoría e inocuidad:** Podés auditar el script antes de ejecutarlo con:
>
> ```sh
> curl -fsSL https://raw.githubusercontent.com/AlvaroTapia-f/agy-bridge/main/install-remote.sh | less
> ```
>
> El script **no requiere ni utiliza `sudo`**, no almacena ni imprime tokens literales, descarga/clona el repositorio en `AGY_BRIDGE_DIR` (`~/.local/share/agy-bridge` por defecto) y `exec`uta el instalador canónico `install.sh`.

Variables de entorno configurables:

- `AGY_BRIDGE_DIR`: Directorio destino (default: `~/.local/share/agy-bridge` o `$XDG_DATA_HOME/agy-bridge`).
- `AGY_BRIDGE_REF`: Rama, tag o commit a clonar/descargar (default: `main`). Ejemplo: `AGY_BRIDGE_REF=v0.2.0 curl -fsSL ... | bash`.

## Opción C: Instalación Manual

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

3. **Instalar plugin de opencode (bundle autocontenido):**
   El plugin `plugins/agy-bridge.ts` se empaqueta como bundle autocontenido con `deno task bundle:plugin` (generado desde `plugins/agy-bridge.plugin.ts` inlinendo `plugins/agy-bridge-helpers.ts`):

   ```sh
   mkdir -p ~/.config/opencode/plugins
   cp plugins/agy-bridge.ts ~/.config/opencode/plugins/agy-bridge.ts
   ```

4. **Registrar provider y modelos en `~/.config/opencode/opencode.json` (global):**
   Replica lo que hace `install.sh` (ver `plugins/agy-bridge.ts`): añade `provider.agy-bridge` (`npm: "@ai-sdk/openai-compatible"`, `options.baseURL: "http://127.0.0.1:7421/v1"`) y `plugin` con la ruta del plugin. Los modelos `auto-ro/rw-*` se generan agrupando el catálogo de `GET /v1/models` por sufijo de esfuerzo; no exponer ids bare `gemini-*`/`claude-*`. Los modelos los escribe `deno task sync:models`.

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

## Detección de versión de opencode

`install.sh` y `scripts/sync-models.ts` comparten `scripts/opencode-version.ts`.
La detección corre `opencode --version`, parsea la salida (`opencode v2.0.20`) y
devuelve el target: `v2` si la mayor es `>= 2`, si no `v1`. El target decide
**qué shape se escribe en `opencode.json`** y si el mapa de modelos se escribe
como config o lo deja en manos del plugin.

Se puede forzar con `AGY_OPENCODE_TARGET=v1|v2` (útil en tests y en máquinas
donde la detección no aplica, p. ej. dentro de un contenedor sin el binario).
Si la detección falla, el default es `v1` — la forma más conservadora, porque
es la que el usuario ya tenía escrita.

## Provider OpenCode (global)

El bridge se expone como provider `agy-bridge` en `~/.config/opencode/opencode.json` (solo global, nunca repo-local). `install.sh` lo configura automáticamente. **La forma depende de la versión de opencode detectada.**

### V1 (`provider`, singular, con `models`)

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
  "plugin": ["file:///home/<user>/.config/opencode/plugins/agy-bridge.ts"]
}
```

El plugin solo resuelve live; sin `models` en JSON no hay efforts.

### V2 (`providers`, plural, sin `models`)

```json
{
  "providers": {
    "agy-bridge": {
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": { "baseURL": "http://127.0.0.1:7421/v1" }
    }
  }
}
```

Tres diferencias, todas medidas contra `opencode v2.0.20`:

1. **`providers` en plural.** V2 ignora por completo la clave `provider`
   (singular). No emite ningún warning: una config V1 que sobreviva a una
   actualización queda leída a medias y sin avisar. `install.sh` borra
   `provider.agy-bridge` cuando migra a V2 justamente por esto.
2. **`package` + `settings.baseURL` en vez de `npm` + `options.baseURL`.**
3. **Sin `models`.** En V2 el catálogo es del plugin
   (`ctx.provider.transform` + `ctx.provider.reload()`), y escribirlo también
   en el config crearía una segunda copia congelada que divergiría del
   catálogo real en silencio. Ver el razonamiento completo en
   [Contrato del modelo](model-contract.md#dual-v1-mapa-estático-vs-v2-catálogo-del-plugin).

**El plugin V2 no se referencia desde `opencode.json`.** V2 auto-descubre los
`.ts`/`.js` del directorio de plugins del config global
(`~/.config/opencode/plugins/`), igual que hace con los plugins de
`gentle-ai`. Las entradas de `plugin` en el config apuntan a **directorios**, no
a archivos: una ruta a archivo se rechaza con
`configured plugin path must be a directory`. Para instalar a mano en V2:

```sh
cp plugins/agy-bridge.v2.bundle.ts ~/.config/opencode/plugins/agy-bridge.v2.bundle.ts
```

`agy-bridge.v2.bundle.ts` debe ir **solo**: es autocontenido a propósito,
porque V2 carga cada `.ts`/`.js` directo de ese directorio como si fuera un
plugin (por eso `agy-bridge-helpers.ts` no debe copiarse ahí).

El runtime también necesita resolver `@opencode/plugin` desde el directorio de
config. En una instalación normal eso ya está (`~/.config/opencode/node_modules`).

- `baseURL` **debe** terminar en `/v1` — el SDK añade `/chat/completions` (sin `/v1` obtienes `404`).
- `Host` guard en el bridge: solo `127.0.0.1:*` o `localhost:*` → `Host: evil.com` devuelve `403`.
- Agrupación por sufijos y selección de variante: ver [Contrato del modelo](model-contract.md). **Nunca** exponer ids bare `gemini-*`/`claude-*`.

## Sincronización de modelos

El task `deno task sync:models` (script `scripts/sync-models.ts`). Cada instalación o actualización con `install.sh` sincroniza automáticamente el catálogo en vivo desde `agy models` TSV hacia `~/.config/opencode/opencode.json` sin duplicar configuraciones ni tocar otros providers. Para resincronizar modelos en cualquier momento sin correr el instalador completo:

```sh
# Sincronización estándar a ~/.config/opencode/opencode.json
deno task sync:models

# Previsualizar el mapa de modelos generado sin escribir archivos
deno task sync:models --dry-run

# Forzar el shape de destino (misma variable que usa install.sh)
AGY_OPENCODE_TARGET=v2 deno task sync:models --dry-run

# Especificar ruta custom de configuración o binario agy alternativo
deno run --allow-run=agy --allow-net=127.0.0.1:7421 --allow-read --allow-write --allow-env scripts/sync-models.ts --config-path /ruta/custom/opencode.json
```

**Qué escribe según el target:**

| target | escribe |Rationale |
|---|---|---|
| `v1` | `provider.agy-bridge.models` (mapa completo con `variants`) | el config es la única fuente del catálogo |
| `v2` | solo `providers.agy-bridge` (package + baseURL) | el catálogo lo publica el plugin |

El mismo script de sync genera las dos formas: `buildModelMap` (V1) y
`buildModelV2` (V2) viven en `plugins/agy-bridge-helpers.ts`, así que ambos
targets leen el mismo mapa declarado y no pueden divergir.

**Resolución en 3 niveles y Dynamic Effort:**

1. `agy models` (TSV en vivo sin necesidad de auth previa del bridge)
2. `GET /v1/models` (endpoint del bridge local)
3. Catálogo base fallback (7 bases agrupadas → 14 modelos `auto-ro/rw-*`, verificado en vivo 2026-09-07)

Cualquier nuevo modelo o esfuerzo de razonamiento expuesto por Antigravity (como `high`, `medium`, `low`, `thinking`, `ultra`) se infiere y agrupa dinámicamente bajo su base correspondiente (`auto-ro-<base>` / `auto-rw-<base>`) con `variants.<effort>.reasoningEffort`. Nunca se exponen ids bare `gemini-*`/`claude-*` directamente en el provider.

## Parche del TUI gentle-ai (effort)

> **Solo V1.** El parche existe porque en V1 el SDK `@ai-sdk/openai-compatible`
> pisa `capabilities.reasoning` del mapa estático. En V2 el plugin declara
> `capabilities` explícito en cada `Model.Info` y no hay mapa estático que
> pisar, así que `install.sh` **no** parchea el TUI cuando el target es V2.

**Por qué existe:** el provider `agy-bridge` publica cada modelo en forma plana — `reasoning: true` a nivel del modelo + `variants.*.reasoningEffort`, sin objeto `capabilities` (verificado con `cat ~/.config/opencode/opencode.json | jq` y `deno test` 80/80). Sin embargo, el SDK `@ai-sdk/openai-compatible` que usa `opencode` enriquece el modelo y deja `capabilities.reasoning` en `false` (o ausente) en `api.state.provider` (el que ve el TUI). Resultado: `/sdd-model` → effort mostraba `Model ... does not expose reasoning effort options` aunque el provider nativo y `/variant` andaban bien.

**Qué hace el instalador (100% transparente):** `install.sh` sección **#7** parchea idempotentemente, si existe, el TUI cacheado de gentle-ai:

```
~/.cache/opencode/packages/opencode-sdd-engram-manage@latest/dist/tui.js
  → listReasoningEffortsFromModel(modelDef)
```

Cambio exacto (no toca otra lógica):

```js
// antes: if (!modelDef || modelDef?.capabilities?.reasoning !== true) return [];
// ahora: if (!modelDef) return [];
//        const hasReasoningEffort = Object.values(modelDef.variants).some(v=>v.reasoningEffort)
//        if (capabilities.reasoning !== true && !hasReasoningEffort) return [];
```

Así `/sdd-model` acepta `agy-bridge` cuando trae `variants.*.reasoningEffort` aunque el SDK lo haya dejado en `false`. Singletons sin variants (ej. `claude-sonnet-4-6`) siguen correctamente en `unsupported`.

**Propiedades:** idempotente (`grep -q hasReasoningEffort` → `already patched`), no toca `agy-bridge.ts` ni systemd, se reaplica solo con `./install.sh`. Si `opencode update` regenera el cache, basta re-correr `./install.sh`. Cuando `gentle-ai` lo fixee upstream, el patrón ya no matchea y el instalador avisa `may be already updated upstream` sin romper nada. Verificable con `grep -n hasReasoningEffort .../tui.js`.

## Auth (sin secretos en repo)

**Automático (recomendado en máquina nueva):** `./install.sh --with-auth` lee `AGY_TOKEN` de `~/.config/agy-bridge/env` y hace upsert en `~/.local/share/opencode/auth.json` preservando otras entradas, `chmod 600`, idempotente. No pisa `opencode-go` ni otras keys.

**Manual (alternativa):** `opencode` → `/connect` → `Other` → `agy-bridge` → pegar `AGY_TOKEN`:

```json
{ "agy-bridge": { "type": "api", "key": "<AGY_TOKEN>" } }
```

`auth.json` y `env` deben ser `chmod 600`. Alternativa: `"apiKey": "{env:AGY_TOKEN}"` con `source ~/.config/agy-bridge/env` antes de lanzar `opencode`. Nunca comitear el token — verifica con `grep -r AGY_TOKEN .` → 0 matches (solo `"{env:AGY_TOKEN}"`).

## Verificación

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

## Rollback

```sh
# Quitar provider y auth, reiniciar opencode
# V1 — Editar ~/.config/opencode/opencode.json: borrar "provider.agy-bridge" y la entrada de "plugin"
# V2 — Editar ~/.config/opencode/opencode.json: borrar "providers.agy-bridge"
#      y borrar el archivo del plugin: rm ~/.config/opencode/plugins/agy-bridge.v2.bundle.ts
#      (en V2 el plugin no se referencia desde el config; se autodestruye borrando el archivo)
# Borrar clave: jq 'del(.["agy-bridge"])' ~/.local/share/opencode/auth.json > /tmp/a.json && mv /tmp/a.json ~/.local/share/opencode/auth.json && chmod 600 ~/.local/share/opencode/auth.json
# Reiniciar TUI y verificar: opencode models | grep -q agy-bridge && echo "still there" || echo "clean"
```

Borrar **las dos** claves (`provider.agy-bridge` y `providers.agy-bridge`) es
inocuo y más seguro si no sabés con qué versión se instaló: la que sobre es
ignorada en silencio por el otro runtime.

No hay cambios en `agy-bridge.ts` ni en systemd; `baseURL` loopback y `accessGuard` (Host 403, Bearer 401) permanecen.

## Purga de `model-variants.json` (solo V1)

`install.sh` borra la entrada `agy-bridge` de
`~/.gentle-ai/cache/model-variants.json` porque ese caché unía genéricos
`{high, low, medium}` en cada fila y servía para enmascarar efforts en el mapa
estático de V1.

**Esta purga está gateada a V1 a propósito.** En V2 el plugin es dueño del
catálogo y ya filtra las variantes no declaradas en cada
`ctx.model.transform`; el caché de `model-variants.ts` no participa del camino
V2, y borrarlo sería tocar estado de otro plugin sin relación.
