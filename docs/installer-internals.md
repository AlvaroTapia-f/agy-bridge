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

## Provider OpenCode (global)

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
- Agrupación por sufijos y selección de variante: ver [Contrato del modelo](model-contract.md). **Nunca** exponer ids bare `gemini-*`/`claude-*`.

## Sincronización de modelos

El task `deno task sync:models` (script `scripts/sync-models.ts`). Cada instalación o actualización con `install.sh` sincroniza automáticamente el catálogo en vivo desde `agy models` TSV hacia `~/.config/opencode/opencode.json` sin duplicar configuraciones ni tocar otros providers. Para resincronizar modelos en cualquier momento sin correr el instalador completo:

```sh
# Sincronización estándar a ~/.config/opencode/opencode.json
deno task sync:models

# Previsualizar el mapa de modelos generado sin escribir archivos
deno task sync:models --dry-run

# Especificar ruta custom de configuración o binario agy alternativo
deno run --allow-run=agy --allow-net=127.0.0.1:7421 --allow-read --allow-write --allow-env scripts/sync-models.ts --config-path /ruta/custom/opencode.json
```

**Resolución en 3 niveles y Dynamic Effort:**

1. `agy models` (TSV en vivo sin necesidad de auth previa del bridge)
2. `GET /v1/models` (endpoint del bridge local)
3. Catálogo base fallback (7 bases agrupadas → 14 modelos `auto-ro/rw-*`, verificado en vivo 2026-09-07)

Cualquier nuevo modelo o esfuerzo de razonamiento expuesto por Antigravity (como `high`, `medium`, `low`, `thinking`, `ultra`) se infiere y agrupa dinámicamente bajo su base correspondiente (`auto-ro-<base>` / `auto-rw-<base>`) con `variants.<effort>.reasoningEffort`. Nunca se exponen ids bare `gemini-*`/`claude-*` directamente en el provider.

## Parche del TUI gentle-ai (effort)

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
# Editar ~/.config/opencode/opencode.json: borrar "provider.agy-bridge" y la entrada de "plugin"
# Borrar clave: jq 'del(.["agy-bridge"])' ~/.local/share/opencode/auth.json > /tmp/a.json && mv /tmp/a.json ~/.local/share/opencode/auth.json && chmod 600 ~/.local/share/opencode/auth.json
# Reiniciar TUI y verificar: opencode models | grep -q agy-bridge && echo "still there" || echo "clean"
```

No hay cambios en `agy-bridge.ts` ni en systemd; `baseURL` loopback y `accessGuard` (Host 403, Bearer 401) permanecen.
