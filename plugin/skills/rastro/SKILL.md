---
name: rastro
description: Esta skill se usa cuando el usuario pregunta "qué sigue", "cómo voy", "voy atrasado", pide "armá el plan", "cambiá la duración de X" o dice "esto no es de esa tarea", "mostrame el dashboard", "abrí el dashboard", "quiero ver el Gantt", "cómo vengo esta semana, en el dashboard", "mostrame el tablero", "sincronizá el plan", "traé el plan de Notion", "traé el plan de la semana que viene", "planeá la semana que viene", "andá armando el plan del lunes", "sugerime el plan de este proyecto", "este repo es de X", "terminé X", "cerrá el día", "el update de hoy", "qué hice hoy" o "armá la daily". Guía el uso de la CLI de Rastro para ver el plan de la semana (y planear la que viene), los desvíos, el cierre del día y corregir duraciones, días o vínculos de commits.
version: 0.2.3
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh siguiente), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh aviso), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh daily --para-pegar), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh start)
---

# Rastro: plan, tiempos y desvíos

Rastro es un observatorio. Solo lee el proyecto y escribe en `~/.rastro/` (tu plan, tu configuración y tu daily, uno solo para todos tus repos) y en `.rastro/` del repo (sus eventos); nunca toca el código del proyecto. Todo se hace con su CLI. `plan cambiar`, `plan sincronizar`, `daily`, `siguiente`, `start`, `publish` y `cron` andan desde cualquier carpeta; `plan <propuesta>`, `plan --sugerir`, `plan --confirmar` y `plan --desde-proyecto` hay que correrlos desde la carpeta de un repo registrado.

## Qué comando corresponde

| El usuario dice | Corré |
| --- | --- |
| "qué sigue", "cómo voy" | `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" siguiente` y `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" aviso` |
| "voy atrasado" | `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" aviso`; si no imprime nada, no hay desvío |
| "armá el plan" (con una propuesta) | `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" plan <propuesta.md>` |
| "cambiá la duración de X" | `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" plan cambiar duracion <tarea> <valor>` (vista previa) |
| "esto no es de esa tarea" | `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" plan cambiar vinculo <sha> <tarea>` (vista previa) |
| "terminé X" | `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" plan cambiar estado <x> hecha` (vista previa) |
| "mostrame el dashboard", "abrí el dashboard", "quiero ver el Gantt", "mostrame el tablero" | el flujo de "Abrir el dashboard" de abajo |
| "cerrá el día", "el update de hoy", "qué hice hoy", "armá la daily" | el flujo de "Cerrar el día" de abajo |
| "sincronizá el plan", "traé el plan de Notion", "traé el plan de la semana que viene" | `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" plan sincronizar` (vista previa; mira esta semana y la que viene) |
| "planeá la semana que viene", "andá armando el plan del lunes" | el flujo de "Planear la semana que viene" de abajo |
| "este repo es de X", "la tarea X es del repo Y" | `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" plan cambiar repo <tarea> <nombre o ninguno>` (vista previa) |
| "sugerime el plan de este proyecto" | `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" plan --desde-proyecto` (vista previa) |
| "dale" al plan sugerido de `--desde-proyecto` | `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" plan --desde-proyecto --confirmar`, solo con el OK explícito |
| "sugerime tareas" | `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" plan --sugerir` |

Para ver los tipos de cambio posibles (duración, día, estado, vínculo, ofrecimiento) corré `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" --help`.

## Abrir el dashboard

Solo si el usuario lo pide ("mostrame el dashboard", "quiero ver el Gantt", "cómo vengo esta semana, en el dashboard"). Si solo pregunta "qué sigue" o "cómo voy", alcanza con la respuesta en el chat (`siguiente` y `aviso`): no abras el dashboard por tu cuenta.

1. Corré `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" start` **en segundo plano**, con la opción de correr un comando en background de tu herramienta Bash: `start` sirve hasta Ctrl+C y bloquearía la sesión.
2. Leé la URL de la salida (`Dashboard: <url>`) y decísela al usuario.
3. Si dice que Rastro ya estaba corriendo, solo informalo.
4. Si sale con error (sin `rastro init`, sin `frontend/dist`), explicá qué falta y sugerí `/rastro:init`.

## Sincronizar con Notion

`siguiente` no lee Notion: corre en el hook de inicio de sesión y tiene que ser rápido, sin red. Por eso, si el usuario pregunta "qué sigue" y dice que cambió el plan en Notion, corré primero `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" plan sincronizar`, mostrá la vista previa y recién después `siguiente`. Repetí `plan sincronizar --confirmar` solo con el OK explícito del usuario.

El plan de Notion se lee en el formato que tenga la página, no hace falta que siga el de Rastro: si una tarea trae un proyecto como etiqueta, `plan sincronizar` le pone el repo registrado de ese proyecto (y avisa si no hay uno). Al publicar, Notion recibe solo los cambios y conserva el formato de la página.

## Planear la semana que viene

Es el mismo flujo de "armá el plan", pero para el lunes que viene: cada comando lleva `--semana-que-viene`, y así nunca toca el plan de esta semana.

1. Con una propuesta (un archivo `.md`), corré `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" plan <propuesta.md> --semana-que-viene`. Sin propuesta, corré `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" plan --desde-proyecto --semana-que-viene`. Los dos dejan una propuesta con los días repartidos desde el lunes que viene; el plan vigente no cambia.
2. Mostrale la tabla y conversá las correcciones. Cada una se aplica con `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" plan cambiar <tipo> <tarea> <valor> --propuesta --semana-que-viene`: primero sin `--confirmar` (vista previa) y recién con el OK repetila con `--confirmar`.
3. Corré `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" plan --confirmar --semana-que-viene` solo con el OK explícito del usuario. Queda como una sección más de `plan.md` y el lunes pasa a ser el plan vigente.

Si Notion ya tiene el plan de la semana que viene, "traé el plan de la semana que viene" corre `plan sincronizar`: lo adopta en su propia sección de `plan.md` (es una escritura local en `~/.rastro/`, con las mismas reglas que esta semana) y muestra qué trajo. La vista previa es solo para publicar. Lo que Rastro arma para la semana que viene queda local: ese lunes pasa a ser el plan vigente y `plan sincronizar --confirmar` lo lleva a Notion, con el OK explícito.

## Cerrar el día

1. Mirá si el daily de hoy ya corrió (automático o a mano): `generadoEn` en `~/.rastro/state.json` trae la fecha de hoy. Si es así, no lo vuelvas a correr (cada daily usa el LLM y cuesta): leé lo que hay con `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" daily --para-pegar`.
2. Si no corrió, corré `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" daily`. Usa el LLM, así que pide permiso.
3. Resumí en pocas líneas qué hiciste, qué sigue y los desvíos.
4. Ofrecé `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" daily --para-pegar` para pegar la bitácora en TaskFlow.
5. Ofrecé `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" publish`. Se corre solo con el OK explícito del usuario y nunca con `--yes`.
6. Cerrá preguntando "¿te abro el dashboard?". Si dice que sí, seguí el flujo de "Abrir el dashboard".

Con "terminé X", proponé `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" plan cambiar estado <x> hecha`, mostrá la vista previa y repetilo con `--confirmar` solo con el OK explícito.

## Reglas

- **Nunca confirmes el plan sin el OK explícito del usuario.** `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" plan --confirmar` (con o sin `--semana-que-viene`) se corre solo después de que el usuario aprobó el plan; el silencio no es un sí.
- Todo cambio se muestra antes con la vista previa: corré el comando sin `--confirmar`, mostrá lo que cambiaría y recién con el OK repetilo con `--confirmar`. Con `--propuesta` el cambio es sobre la propuesta y no sobre el plan vigente.
- No publiques en Notion ni en ningún sistema externo sin el OK explícito del usuario, que tiene que nombrar que se escribe en Notion, y solo con `plan sincronizar --confirmar` o `publish`.
- Si el script sale con 127, no se encontró la CLI de Rastro: decíselo al usuario y no lo tomes como "sin desvíos".
- Si el aviso dice que hay commits fuera del plan, sugerile nombrar la tarea con `[Tarea]` en el mensaje del commit, o corregir el vínculo con `plan cambiar vinculo`.
- Si no hay plan vigente, decilo y sugerí `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" plan <propuesta.md>`.
