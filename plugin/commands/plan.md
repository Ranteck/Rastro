---
description: Armá el plan de la semana a partir de una propuesta y confirmalo con tu OK
argument-hint: <propuesta.md>
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh plan cambiar *)
---

Armá el plan de la semana con Rastro a partir de la propuesta `$ARGUMENTS`.

1. Corré `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" plan $ARGUMENTS`. Deja una propuesta en `~/.rastro/plan.sugerido.md`; el plan vigente no cambia.
2. Mostrale al usuario la tabla de tareas con su duración y sus días.
3. Conversá las correcciones con el usuario: duraciones, días, tareas que no entran, tareas que sobran. No decidas por él.
4. Aplicá cada corrección acordada con `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" plan cambiar <tipo> <tarea> <valor> --propuesta --confirmar`. Antes de aplicarla, corré el mismo comando sin `--confirmar` y mostrale la vista previa.
5. Corré `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" plan --confirmar` **solo cuando el usuario lo apruebe de forma explícita**. Nunca confirmes el plan por tu cuenta ni tomes el silencio como un sí. Si no hay un OK claro, preguntá.

Si el usuario pide el plan de la semana que viene, sumá `--semana-que-viene` en los pasos 1, 4 y 5: la propuesta y la confirmación son del lunes que viene y el plan de esta semana no se toca.

Armar la propuesta (paso 1) y confirmar el plan (paso 5) piden permiso a propósito: el sistema de permisos es la segunda puerta además del OK del usuario.

Rastro es un observatorio: solo escribe en `~/.rastro/` y en `.rastro/` del repo. No edites el código del proyecto desde este comando.
