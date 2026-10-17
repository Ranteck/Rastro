---
description: Qué sigue en el plan de la semana y cómo vas de atraso
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh siguiente), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh aviso)
---

Corré `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" siguiente` y `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" aviso`, y resumí el resultado en dos o tres líneas: qué estás haciendo ahora, qué sigue (con su duración y sus días) y si hay atrasos o tareas que no entran. Si `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" aviso` no imprime nada, no hay desvíos: no lo menciones como problema. Si no hay plan vigente, sugerí `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" plan <propuesta.md>`.

Si el script sale con 127, no se encontró la CLI de Rastro: decíselo al usuario y no lo presentes como "sin desvíos".
