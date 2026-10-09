# Rastro

Memoria de equipo con evidencia. Rastro cruza lo que pasó en el código con el plan de la semana y muestra qué está resuelto, qué está pendiente y con qué evidencia: *"Está resuelto en el código; nadie cerró el ticket."*

No corre todo el tiempo. Se activa en momentos concretos: un post-commit que anota el evento y avisa si te desviás del plan, el fin de una sesión de Claude Code y `rastro daily`, a demanda o por cron. Nada se comparte con el central ni con Notion sin `rastro publish`. `daily` y `plan` sí mandan texto, con los secretos redactados, a `claude -p`, salvo que pongas `llm.proveedor: "ninguno"`.

## Estructura

- `backend/`: el motor (CLI, `package.json`, `bin/`, `src/`, `test/`).
- `frontend/`: la UI (ver `frontend/README.md`).
- `intent/`: intent, spec y plan.

## Requisitos

Node ≥ 22.18 (ejecuta TypeScript sin compilar) y, para el resumen, `claude` en el PATH.

## Uso

Los comandos se corren desde el repo que querés seguir. Desde la raíz de este repo:

```bash
node backend/bin/rastro.js init --equipo "AI Day"    # .rastro/, post-commit y hook SessionEnd
node backend/bin/rastro.js plan propuesta.md         # arma .rastro/plan.md (formato daily-flock)
git commit -m "[Pendientes] detector"                # [Tarea] vincula el commit con la tarea
node backend/bin/rastro.js daily                     # bitácora, pendientes, desvíos y resumen
node backend/bin/rastro.js serve                     # central en http://127.0.0.1:4317
node backend/bin/rastro.js seed-demo                 # compañeros de ejemplo para la vista de equipo
node backend/bin/rastro.js publish                   # muestra qué sale, pide confirmación y publica
```

Desde otro repo, llamá a la ruta absoluta de `backend/bin/rastro.js`. Otras opciones: `plan --sugerir`, `daily --desde AAAA-MM-DD`, `publish --yes`, `serve --puerto N --datos dir`, `seed-demo --central url`.

## Privacidad

- Los secretos (`sk-…`, `ghp_…`, `AKIA…`, `Bearer …`, `*_TOKEN=`, `password=`) se redactan antes de llamar al LLM y antes de cualquier conector (`rastro publish`). El `.rastro/state.json` local no se redacta.
- Las sugerencias de automatización salen de tu terminal y no se comparten salvo que pongas `compartir.sugerencias: true` en `.rastro/config.json`.
- El central escucha solo en localhost: no tiene autenticación todavía.

## Configuración

`.rastro/config.json` (lo crea `init`): persona, zona horaria, conectores (`central`, `notion`), umbrales de pendientes, desvíos y repeticiones, y el LLM (`claude-cli` con `haiku` por defecto, o `ninguno`).

`notion.modo` es `mock` (por defecto: escribe `.rastro/notion-preview.md`) o `claude` (publica en la página Daily con `claude -p`, usando la skill daily-flock instalada en `~/.claude/skills/daily-flock`). En modo `claude`, `claude -p` corre solo con la skill daily-flock y las dos herramientas de Notion (`notion-fetch` y `notion-update-page`), y cuesta unos centavos por publicación. `notion.pagina` (opcional) es el id de una página de Notion (32 caracteres hexadecimales, con o sin guiones): en modo `claude`, publica al final de esa página en vez de la Daily.

## Limitaciones conocidas

- El hook post-commit llama a `node` del PATH. Con gestores de versiones como fnm, los commits hechos desde clientes gráficos pueden no registrar el evento; la bitácora basada en git sigue funcionando.
- "Resuelto sin cerrar" asume merge commits (`--no-ff` o merges de PR): los merges squash o fast-forward todavía no se detectan.

## Desarrollo

```bash
cd backend && npm install && npm run check    # tsc estricto + node --test
```

El contrato entre el motor y la UI está en `intent/spec.md` (sección "Contrato") y en `backend/src/contract/snapshot.ts`. El pedido de la UI está en `frontend/README.md`.
