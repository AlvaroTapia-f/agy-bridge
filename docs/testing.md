# Testing

[← Volver al README](../README.md) · [Arquitectura](architecture.md) ·
[Contrato del modelo](model-contract.md) ·
[Internals del instalador](installer-internals.md)

## Suite

Suite verde con `deno task test` (80/80 verificado en vivo el 2026-09-08).
Re-verificá con el comando antes de citar el número: el conteo rota, el
comando no.

```sh
deno task test
```

La suite cubre el guard de `Host` (403), auth Bearer (401), ruteo y errores
400, streaming SSE, deadline-kill (502), salvage de transcript, retry de
sesión, hermeticidad del harness con `usage.jsonl` en `STATE_DIR` temporal, y
la resolución de modelos en 3 niveles (`scripts/sync-models.ts`) incluyendo el
fallback de 14 modelos.

Smoke test manual post-instalación (puente vivo, variante → wire id):
ver [Verificación](installer-internals.md#verificación), paso 5
(`POST auto-ro-*`).

## Smoke tests de plugin (V1 y V2)

```sh
bash tests/plugin-smoke.sh      # plugin V1 contra el binario opencode real
bash tests/plugin-smoke-v2.sh   # bundle V2 contra el binario opencode real
```

Los dos corren contra el `opencode` instalado en la máquina y **nunca tocan
`~/.config/opencode`**: cada uno arma su sandbox en `mktemp -d`. El de V2 aísla
además data y state con `XDG_CONFIG_HOME` / `XDG_DATA_HOME` /
`XDG_STATE_HOME`, y levanta su propio `opencode serve` privado en un puerto
libre, porque en modo servicio el comando habla con el proceso de fondo que ya
cargó sus plugins al arrancar y jamás vería un sandbox nuevo.

`plugin-smoke-v2.sh` corre tres casos: catálogo con el bridge en `7421`,
catálogo con el bridge caído (fallback), y un caso informativo con una config
V1 remanente. El assert central es que los **variantes de effort lleguen al
runtime** — es exactamente lo que V1 perdía en silencio — y lo delega en
`tests/assert-v2-variants.py`, que compara contra un `/api/model` real.

## Diagnóstico

```sh
systemctl --user status agy-bridge
journalctl --user -u agy-bridge -f
tail ~/.local/state/agy-bridge/usage.jsonl
# Smoke test: ver Verificación paso 5 (POST auto-ro-*)
```

Si agy cambia flags/eventos (stream-json), el bridge rompe: revisar
`agy --help`, ajustar parser y correr el smoke test de Verificación.

## SDD

El flujo de desarrollo sigue Spec-Driven Development bajo `openspec/`; el
parche del TUI que mantiene verde `/sdd-model` con `agy-bridge` se documenta
en [Parche del TUI](installer-internals.md#parche-del-tui-gentle-ai-effort).
