---
description: Abrí el dashboard de Rastro en el navegador, levantando el central si hace falta
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh start)
---

Abrí el dashboard de Rastro. Es uno solo, con todos los repos observados, así que no depende del proyecto actual.

1. Corré `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" start` **en segundo plano**, con la opción de correr un comando en background de tu herramienta Bash. `start` sirve hasta Ctrl+C: en primer plano bloquearía la sesión.
2. Leé la salida del proceso en segundo plano y decile al usuario la URL del dashboard (la línea `Dashboard: <url>`).
3. Si `start` dice que Rastro ya estaba corriendo, informalo: solo se abrió el navegador y no hay nada más que levantar.
4. Si `start` sale con error (por ejemplo, falta `rastro init` o falta `frontend/dist`; si avisa que el dashboard es de otra versión, también), explicá qué falta y sugerí `/rastro:init`.

Rastro es un observatorio: ver el dashboard no escribe nada del proyecto. El central que levantaste queda atado a esta sesión.
