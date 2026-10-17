# Changelog

Todos los cambios notables de Rastro se documentan acá. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el versionado, [SemVer](https://semver.org/lang/es/).

## [0.2.4] - 2026-10-16

### Cambiado

- **Cómo se publica Rastro:** desde esta versión, cada release se publica en este repositorio como un solo commit ("Rastro vX.Y.Z"), con su tag y su release, y el contenido es lo mismo que se instala. La instalación no cambia: `/plugin marketplace add Ranteck/Rastro`, `/plugin install rastro@rastro` y `/plugin marketplace update rastro`.

## [0.2.3] - 2026-10-16

### Agregado

- **La semana que viene:** `rastro plan sincronizar` y el `daily` leen de Notion el plan de esta semana y el de la que viene, si ya existe. Cada una es su propia sección de `plan.md`, con su propia base de sincronización y las mismas reglas (solo lectura en el `daily`, nulos, nombres repetidos) por semana; el lunes la que venía pasa a ser la vigente. El `daily` lo dice: "Ya está el plan de la semana del 19/10 (5 tareas)". La extracción del LLM recibe el lunes que viene y devuelve los dos planes, cada uno con su semana; uno rotulado con otra semana no se adopta.
- **`--semana-que-viene`** en `rastro plan <propuesta.md>`, `plan --desde-proyecto`, `plan --confirmar` y `plan cambiar --propuesta`: la propuesta, el reparto de días (desde el lunes que viene) y la confirmación son de la semana siguiente y no tocan el plan de esta.
- **`rastro siguiente`** avisa si no hay plan esta semana pero sí para la que viene, y desde el viernes suma una línea con el plan de la semana que viene.
- **El dashboard sabe de la semana que viene:** si esta semana no tiene plan pero la que viene sí, Plan lo dice en vez de ofrecer armar uno (el central suma `queViene` a la respuesta de `/api/persona`, solo con la semana y la cantidad de tareas).
- **Skill:** disparadores "planeá la semana que viene", "andá armando el plan del lunes" y "traé el plan de la semana que viene".

### Cambiado

- **Menos comandos a la vista:** en el modo personal el dashboard no muestra la pestaña Equipo (el modo equipo está en pausa) y abre en Mi día. Los estados vacíos (Mi día y Pendientes sin daily, Plan sin plan) dicen primero qué decirle a Claude ("Decile a Claude «cerrá el día»") y dejan el comando como alternativa, en "o en la terminal". El modo equipo no cambia.
- **Los mensajes de la CLI que mandan a correr otro comando** (`start`, `siguiente`, `daily` y `plan sincronizar`) suman la frase para Claude: "(o decile a Claude «cerrá el día»)".
- **Base de sincronización con Notion** (`notion-base.md`): una sección por semana, como `plan.md`. Una base de una sola semana se sigue leyendo.

## [0.2.2] - 2026-10-16

### Arreglado

- **El dashboard antes del primer `daily` ya no dice "No encontré a esa persona":** en una máquina nueva, después de `/rastro:init`, Mi día explica que todavía no corrió el daily, ofrece `rastro daily` en un bloque copiable y muestra la hora del daily automático si hay uno instalado. Plan muestra las tareas de `plan.md` (duración, días y repo, con edición y vista previa) y avisa que la bitácora y el Gantt llegan con el primer daily.
- **Los errores del central muestran su mensaje** en vez del texto genérico; "No encontré a esa persona" queda solo para un id que no existe.
- **`rastro start` avisa por stderr si todavía no hay daily** y sirve igual.

## [0.2.1] - 2026-10-16

### Cambiado

- **El daily automático usa el programador de la máquina:** `rastro cron instalar` instala un timer de systemd de usuario en Linux (`Persistent=true`, así recupera el daily de una hora en que la máquina estaba apagada), un LaunchAgent en macOS y `crontab` solo si no hay ninguno de los dos. No pide `sudo` ni instala paquetes. La tarea fija `RASTRO_HOME`, el `PATH` y `CLAUDE_CONFIG_DIR` (si estaba definida) y deja la salida en `cron.log`.
- **Una sola tarea:** al instalar, Rastro saca sus líneas del `crontab` (la global y las viejas por repo) y la instalación de otro programador. Los comandos (`rastro cron`, `instalar [--hora HH:MM]` y `quitar`) no cambian de nombre; el estado nombra el programador.

### Arreglado

- **`rastro cron instalar` ya no falla donde no hay `crontab`** (Arch, Ubuntu reciente). Si no hay ningún programador, lo dice, explica qué instalar y sale con 0 para que `/rastro:init` siga con los demás pasos.

## [0.2.0] - 2026-10-16

Rastro pasa a ser global: una instalación que observa varios repos.

Para actualizar desde 0.1.x, corré `/rastro:init` otra vez en cada repo (ver "Desde 0.1.x" en el README). El dashboard construido en 0.1.x no sirve con 0.2.0: `/rastro:init` lo reconstruye solo.

### Agregado

- **Datos globales:** la configuración, el plan, el daily y el chat viven en `~/.rastro/` (o `$RASTRO_HOME`). Cada repo registrado guarda solo `.rastro/events.jsonl`.
- **`rastro plan --desde-proyecto [--propuesta <archivo>] [--confirmar]`:** sugiere el plan desde el estado del proyecto. `/rastro:init` lo corre al final y muestra la vista previa; confirmarlo es un paso aparte del usuario, con `--desde-proyecto --confirmar` (confirma la propuesta si no hay plan vigente, o acepta los ofrecimientos del repo).
- **`rastro plan sincronizar [--confirmar] [--usar notion|rastro]`:** sincroniza el plan con Notion, con vista previa. La skill lo usa con "sincronizá el plan" y "traé el plan de Notion".
- **`rastro plan cambiar repo <tarea> <nombre|ninguno>`** y `· repo:<nombre>` en las tareas del plan. El repo se ve en el plan, la bitácora, el Gantt y los ofrecimientos.
- **`rastro siguiente --si-registrado`:** lo usa el contexto de sesión; calla fuera de un repo registrado.
- **`frontend/dist/version.txt`:** el build deja la versión del frontend. `/rastro:init` reconstruye el dashboard si falta o no coincide (`scripts/dashboard-al-dia.sh`), y `rastro start` avisa por stderr, sin frenar, cuando el dashboard no es de la versión de la CLI.

### Cambiado

- **Un solo cron:** `rastro cron instalar` deja una línea global (`# rastro:global`) que corre el daily de todos los repos y reemplaza a las líneas viejas por repo. La salida va a `~/.rastro/cron.log`.
- **`rastro init`:** registra el repo e instala sus hooks; la configuración global se crea si no existe.
- **`/rastro:init`:** diagnostica el registro con `siguiente --si-registrado`, instala el cron global solo si falta y termina con el plan sugerido.
- **Desde cualquier carpeta:** `plan cambiar`, `plan sincronizar`, `daily`, `siguiente`, `start`, `publish` y `cron`. `plan <propuesta>`, `--sugerir`, `--confirmar` y `--desde-proyecto` piden un repo registrado.
- **El plan de Notion se lee en el formato que tenga la página:** en modo `claude`, `claude -p` (solo lectura, con las mismas restricciones de antes) extrae las tareas de la semana en vez de copiar un bloque. Las tareas con un proyecto como etiqueta toman el repo de ese proyecto si está registrado (si no, quedan sin repo y se avisa), y la duración o los días ilegibles quedan sin valor. La base (`notion-base.md`) guarda el plan normalizado, así que reescribir la página sin cambiar tareas no cuenta como cambio.
- **Los nombres de tarea no cambian de una lectura a otra:** la lectura de Notion le pasa al LLM los nombres que Rastro ya conoce (los de la base o, sin base, los del plan local). Los avisos de la lectura (repo no registrado, duración o días ilegibles) salen en `plan sincronizar` y en el `daily`. Una tarea puede llevar días sin duración (`· jue`). Lo que la página no dice no es un cambio: el objetivo no se compara (al adoptar, una tarea conocida conserva el suyo) y una duración, unos días o un repo que Notion no trae valen lo que tiene Rastro; solo un valor distinto de Notion o un cambio de estado cuenta.
- **Publicar respeta el formato de la página:** si ya tiene el plan de la semana, `plan sincronizar --confirmar` le pide a Notion solo los cambios (agregadas, sacadas y campos cambiados) y conservar sus etiquetas, su orden y su estilo; el bloque completo se agrega solo si la página no tiene el plan de esta semana. El modo `mock` sigue usando el formato de Rastro.
- **`daily` adopta el plan de Notion en modo lectura** cuando es lo único que cambió y solo agrega tareas o cambia duraciones, días o estados; lista lo que cambió. Si Notion saca tareas o repos, avisa las diferencias y no adopta: lo decidís con `rastro plan sincronizar --usar notion`.
- **`plan <propuesta.md>` y `plan --confirmar` en el plan global:** las tareas llevan el repo donde corrés el comando y confirmar reemplaza solo las de los repos que trae la propuesta, conservando las de los otros repos y las sin repo, e informa lo que quita. `plan <propuesta>` y `--desde-proyecto` conservan en la propuesta las tareas de otros repos.
- **El aviso de desvío** mide los commits de hoy de todos los repos observados: da lo mismo desde cualquiera.
- **`rastro cron`** informa las líneas viejas por repo que quedan en el crontab.

### Quitado

- **`rastro serve --repo`:** lo reemplaza `rastro serve --personal`.
- **Configuración y plan por repo:** los `config.json` y `plan.md` de cada `.rastro/` dejan de usarse y no se migran.

## [0.1.3] - 2026-10-15

### Cambiado

- **`/rastro:init` sin repreguntar:** escribirlo ya es el OK. Diagnostica, dice lo que va a hacer y lo corre de una, con sus comandos preaprobados. Los ajustes van como argumento: `/rastro:init sin cron`, `/rastro:init cron 19:00`, `/rastro:init sin dashboard`.

## [0.1.2] - 2026-10-15

### Cambiado

- **Plugin instalable desde GitHub:** `scripts/raiz-rastro.sh` encuentra la raíz del repo (junto al plugin o en el marketplace clonado) y `rastro.sh` y `/rastro:init` la usan en vez de `../backend`. La instalación del README pasa a `/plugin marketplace add Ranteck/Rastro`.
- **Ramas:** `main` pasa a ser la versión viva; la entrega del AI Day queda en la rama `ai-day` y en el tag `ai-day-2026`.
- **Releases:** cada versión se publica como release de GitHub, y el README explica cómo fijar la instalación a un tag.

### Seguridad

- `raiz-rastro.sh` solo acepta el marketplace llamado `rastro`, con su manifiesto y su CLI. Otro marketplace que declare un plugin `rastro` no puede hacer que se ejecute su código.

## [0.1.1] - 2026-10-15

### Agregado

- **Dashboard desde la conversación:** `/rastro:dashboard` y la skill `rastro` ("mostrame el dashboard", "quiero ver el Gantt") abren el dashboard con `rastro start` en segundo plano. "Cerrá el día" termina preguntando si lo abrís.

## [0.1.0] - 2026-10-15

Primera release versionada: el copiloto personal sobre la base del AI Day (tag `ai-day-2026`).

### Agregado

- **Plan con duraciones y reparto:** `rastro plan` propone tareas con duración y días, y `--confirmar` lo deja vigente.
- **Plan con disponibilidad:** el reparto es determinístico según `disponibilidad` de la config.
- **Cambios con vista previa:** `rastro plan cambiar` (duración, día, estado, vínculo, ofrecimiento) previsualiza y aplica solo con `--confirmar`.
- **Gantt real, atraso y foco:** el snapshot v2 suma Gantt, tareas atrasadas, foco y ofrecimientos, y el dashboard los muestra.
- **Modo personal del central:** `rastro serve --repo` muestra tu `state.json`, con edición directa del plan y un chat que solo propone cambios.
- **Plugin de Claude Code:** marketplace local, `/rastro:init`, `/rastro:plan`, `/rastro:siguiente`, contexto del plan al abrir la sesión y "cerrá el día".
- **Avisos sin LLM:** `rastro aviso` y `rastro siguiente`, y el aviso de desvío tras cada commit.
- **`rastro cron`:** instala, quita o muestra el daily de lunes a viernes.
- **`rastro start`:** levanta el central sobre el repo y abre el dashboard.
- **`rastro --version`** y la versión en la primera línea de `rastro --help`.

### Seguridad

- Los POST del modo personal llevan un token de sesión en `X-Rastro-Token`.
- Se rechazan el host y el `Origin` que no sean locales.
- El chat corre sin herramientas ni hooks.
- El `sessionId` del chat se valida antes de usarse.
