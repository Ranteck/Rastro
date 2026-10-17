---
description: Dejá Rastro listo en este proyecto de una vez: CLI, registro del repo, daily automático, dashboard y plan sugerido
argument-hint: "[sin cron | cron HH:MM | sin dashboard]"
allowed-tools: Bash(command -v rastro), Bash(cd *), Bash(npm install), Bash(npm link), Bash(npm run build), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/raiz-rastro.sh), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/dashboard-al-dia.sh), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh init), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh siguiente --si-registrado), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh cron), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh cron instalar), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh cron instalar --hora *), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh plan --desde-proyecto)
---

Prepará Rastro en el proyecto actual en una sola corrida. **Que el usuario haya escrito `/rastro:init` es su OK:** no le vuelvas a preguntar. Sus ajustes llegan como argumento: $ARGUMENTS ("sin cron" saca el cron, "cron 19:00" cambia la hora, "sin dashboard" saca el build).

1. **Diagnóstico, sin escribir nada:**
   - `command -v rastro`, para saber si la CLI está en el PATH;
   - `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" siguiente --si-registrado`, para saber si este repo ya está registrado (si no imprime nada, no lo está);
   - `"${CLAUDE_PLUGIN_ROOT}/scripts/raiz-rastro.sh"`, la raíz del repo de Rastro, de acá en más `<raíz>` (si sale sin imprimir nada, no hay raíz);
   - `"${CLAUDE_PLUGIN_ROOT}/scripts/dashboard-al-dia.sh"`, para saber si el dashboard construido es de la versión actual: imprime `al-dia`, `falta` o `desactualizado` (o `sin-raiz`). Que salga con 1 es el diagnóstico, no un error. Después de actualizar el plugin queda el build viejo, que no sirve con la CLI nueva.
2. **Decí en una lista corta lo que vas a hacer**, solo con lo que falta, y empezá enseguida, sin esperar respuesta. Si todo ya está instalado, decilo igual y corré solo el último paso (el plan sugerido): así una segunda corrida de `/rastro:init` refresca las sugerencias. Los pasos, en este orden:
   - **instalar la CLI:** `cd <raíz>/backend && npm install && npm link` (la CLI no tiene dependencias en tiempo de ejecución). Si no hay raíz, saltealo junto con el build del dashboard y explicá que hay que instalar el plugin desde el marketplace (`/plugin marketplace add Ranteck/Rastro`) o clonar el repo de Rastro;
   - **registrar el repo:** `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" init`. Lo anota en tu Rastro global e instala sus hooks; la configuración global se crea si no existe;
   - **el `daily` automático global**, de lunes a viernes a las 18:30 o a la hora del argumento: `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" cron instalar [--hora HH:MM]`. Antes revisá con `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" cron` si ya está instalado: si ya está, no lo toques, salvo que informe líneas viejas por repo (son de la versión anterior y cada una corre hoy el daily de todos los repos): en ese caso reinstalalo con la misma hora que informó (`cron instalar --hora HH:MM`), que también las saca. Rastro usa el programador que tenga la máquina (un timer de systemd de usuario en Linux, launchd en macOS, `crontab` solo si no hay ninguno de los dos) y no pide `sudo` ni instala paquetes; con systemd recupera el daily de una hora en que la máquina estaba apagada. Si no encuentra ningún programador, el comando lo dice, explica qué instalar y sale bien: seguí con los demás pasos y pasale ese mensaje al usuario. En la lista aclará que es un solo daily automático para todos tus repos y que reemplaza a los de antes (uno por repo, también los de crontab), que corre en su máquina, que cuesta alrededor de 1 centavo por día y que se saca con `rastro cron quitar`. Con `sin cron` no lo instales, pero corré igual `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" cron` (solo lee): si informa líneas viejas por repo, contale al usuario que cada una corre hoy el daily de todos los repos y que `rastro cron quitar` las saca (no las quites vos);
   - **construir el dashboard**, si el diagnóstico dijo `falta` o `desactualizado` (en el segundo caso aclará que el de antes era de otra versión): `cd <raíz>/frontend && npm install && npm run build`;
   - **sugerir el plan desde el proyecto:** `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" plan --desde-proyecto`. Es el último paso, se corre siempre (también cuando todo lo demás ya estaba) y muestra una vista previa.
3. **Corré todo de corrido, en ese orden, sin volver a preguntar.** Si un paso falla, frená ahí, decí cuál falló y con qué error, y no sigas con los demás.
4. **Cerrá** con:
   - qué quedó instalado;
   - `rastro start` para abrir el dashboard;
   - la vista previa del plan sugerido. **Tu plan todavía no cambió:** el plan sugerido lo confirma el usuario después, y cuando diga "dale" u OK se corre `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh" plan --desde-proyecto --confirmar` (también a mano con `rastro plan --desde-proyecto --confirmar`), porque cambia su plan. Ese comando no lo corras desde acá. Si prefiere partir de una propuesta, `/rastro:plan <propuesta.md>`.

   Si instalaste la CLI, contá que `/plugin marketplace update rastro` también la actualiza, porque el `npm link` apunta a la copia del marketplace. Si el plugin se cargó con `--plugin-dir` y no está instalado, contá que puede dejarlo para todas sus sesiones con `/plugin marketplace add Ranteck/Rastro` y `/plugin install rastro@rastro`.

   No edites `~/.zshrc` ni otros archivos del usuario.

Reglas:
- Rastro es un observatorio: solo escribe en `~/.rastro/`, en `.rastro/` del repo, en lo que escribe `rastro init` (`.git/hooks/post-commit`, `.git/info/exclude` y `.claude/settings.local.json`), en la CLI y el dashboard de `<raíz>` y en la línea global del crontab. No edites el código del proyecto desde este comando.
- No corras otros comandos que los de esta lista.
- Si `"${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh"` sale con 127, no se encontró la CLI de Rastro: decíselo al usuario y no sigas con los pasos que la necesitan, salvo instalarla.
