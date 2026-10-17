# Rastro

Tu plan de la semana contra lo que pasó en el código, con evidencia. Nació como memoria de equipo para el Flock AI Day 2026 y hoy es un copiloto personal y global: una sola instalación, una configuración, un plan, un cron y un dashboard para todos tus repos. Sugiere el plan con duraciones, avisa cuando vas atrasado y arma la bitácora. Rastro cruza lo que pasó en el código con el plan de la semana y muestra qué está resuelto, qué está pendiente y con qué evidencia: *"Está resuelto en el código; nadie cerró el ticket."*

No corre todo el tiempo. Se activa en momentos concretos: un post-commit que anota el evento y avisa si te desviás del plan, el fin de una sesión de Claude Code y `rastro daily`, a demanda o por cron. Nada se comparte con el central ni con Notion sin `rastro publish`. `daily` y `plan` sí mandan texto, con los secretos redactados, a `claude -p`, salvo que pongas `llm.proveedor: "ninguno"`.

Versiones y novedades en el [CHANGELOG](CHANGELOG.md).

## Estructura

- `backend/`: el motor (CLI, `package.json`, `bin/`, `src/`, `test/`).
- `frontend/`: la UI (ver `frontend/README.md`).
- `intent/`: intent, spec y plan.

## Requisitos

Node ≥ 22.18 (ejecuta TypeScript sin compilar) y, para el resumen, `claude` en el PATH.

## Primeros pasos

Necesitás [Node](https://nodejs.org) 22 o más nuevo y [Claude Code](https://claude.com/claude-code).
El daily automático usa el programador de tu máquina: en Arch y en Ubuntu alcanza con systemd, no hace falta `crontab`. En WSL, activá systemd en `/etc/wsl.conf` (`[boot]` con `systemd=true`) o instalá `cron`.

### 1. Instalá el plugin (una sola vez)

Abrí Claude Code en cualquier carpeta y escribí:

```
/plugin marketplace add Ranteck/Rastro
/plugin install rastro@rastro
```

La primera línea agrega este repo como fuente de plugins; la segunda instala Rastro para todas tus
sesiones. Si `/rastro:init` no aparece todavía, reiniciá Claude Code.

Así seguís `main`, que siempre es la última versión (los cambios están en el [CHANGELOG](CHANGELOG.md)).

### 2. Prendelo en tu proyecto

Abrí Claude Code en el proyecto que querés seguir y escribí:

```
/rastro:init
```

Rastro revisa qué falta y te lo muestra en una lista: instalar la CLI `rastro`, registrar el
repo (sus hooks de commit y de fin de sesión), el `daily` automático global de lunes a viernes a
las 18:30, el dashboard y, al final, una vista previa del plan sugerido desde el proyecto. Lo hace
todo de una, sin preguntar; para cambiar algo, pasalo como argumento: `/rastro:init sin cron`, `/rastro:init cron 19:00` o `/rastro:init sin dashboard`. Repetí este paso en cada
repo que quieras seguir: Rastro solo observa los repos donde corriste `/rastro:init`. La
configuración, el plan y el daily automático son uno solo para todos.

El plan sugerido no cambia tu plan todavía: lo confirmás vos después, diciendo "dale" o con
`rastro plan --desde-proyecto --confirmar`. Ese comando confirma lo que dejó `--desde-proyecto`:
si no tenías plan vigente, la propuesta (como `rastro plan --confirmar`), que junta las tareas de
todos los repos donde corriste `/rastro:init` antes de confirmar; si ya tenías uno, los
ofrecimientos pendientes del repo.

### 3. Armá el plan de la semana

Desde una propuesta:

```
/rastro:plan Docs/propuesta.md
```

O pedile que lo sugiera desde el estado del proyecto (la propuesta, el intent y el git del repo):

```bash
rastro plan --desde-proyecto
```

Te propone las tareas con duración y días. Las corregís conversando ("esa me lleva dos días") y
confirmás cuando te cierra. Si lo llevás en Notion, "sincronizá el plan" (o `rastro plan sincronizar`)
trae lo que cambiaste allá.

#### La semana que viene

Si ya tenés el plan del lunes en Notion, "traé el plan de la semana que viene" lo trae: `rastro plan
sincronizar` y el `daily` miran esta semana y la que viene, cada una con su propia sección en `plan.md` y
su propia base de sincronización. El lunes, esa sección pasa a ser el plan vigente.

Si querés adelantarlo vos, decile "planeá la semana que viene" o "andá armando el plan del lunes":
`rastro plan <propuesta.md> --semana-que-viene` (o `rastro plan --desde-proyecto --semana-que-viene`)
deja una propuesta con los días repartidos desde el lunes que viene, y
`rastro plan --confirmar --semana-que-viene` la deja como plan de esa semana, sin tocar el de esta.
`rastro plan cambiar … --propuesta --semana-que-viene` corrige la propuesta antes de confirmar.
Lo que armás para la semana que viene queda solo en Rastro: ese lunes pasa a ser el plan vigente y
`rastro plan sincronizar --confirmar` lo lleva a Notion. La propuesta es un solo archivo: armar la de otra
semana descarta la pendiente y lo dice, con sus tareas.

### 4. Usalo hablando

Desde ahí no hace falta ningún comando: en el día a día le hablás a Claude, y el dashboard también te dice qué pedirle
(los comandos quedan de alternativa, para copiar):

- Al abrir Claude Code, la sesión ya sabe qué estás haciendo, qué sigue y qué va atrasado.
- Al commitear, si te desviás del plan, aparece el aviso.
- "¿Qué sigue?", "terminé X", "mostrame el dashboard".
- "Cerrá el día": resumen, texto para pegar en tu backoffice y, con tu OK, Notion.

Desde la terminal, para abrir el dashboard en el navegador:

```bash
rastro start
```

### Actualizar y desinstalar

Actualizar el plugin y la CLI, en Claude Code:

```
/plugin marketplace update rastro
/reload-plugins
```

#### Desde 0.1.x

Corré `/rastro:init` otra vez en cada repo. Los `plan.md` y `config.json` de cada repo dejan de
usarse y no se migran: el plan y la configuración viven ahora en `~/.rastro/`. El daily automático global
reemplaza a los de antes (uno por repo) al instalarlo.

El dashboard construido en 0.1.x no sirve con 0.2.0 (otro contrato): `/rastro:init` lo reconstruye si
`frontend/dist/version.txt` falta o no coincide con la versión de `frontend/package.json`. A mano:
`cd frontend && npm install && npm run build`. Si abrís el dashboard con `rastro start` sin haberlo
reconstruido, avisa por stderr y lo sirve igual.

Desinstalar el plugin, en Claude Code:

```
/plugin uninstall rastro@rastro
```

Sacar el `daily` automático (es uno solo, para todos tus repos), en la terminal:

```bash
rastro cron quitar
```

El daily automático corre en tu máquina, no en GitHub. Con systemd, si estaba apagada a esa hora, lo recupera
al prenderla; con launchd o `crontab`, ese día no corre y "cerrá el día" arma el daily en el momento.

### Para desarrollar Rastro

Desde un clon de este repo, una de las dos (no las dos a la vez, o los hooks corren dos veces):

```bash
claude plugin marketplace add <ruta al clon>     # instalado, lee del clon
claude --plugin-dir <ruta al clon>/plugin        # solo para esa sesión
```

Tests:

```bash
cd backend && npm run check
cd ../frontend && npm run check
```

## Qué se guarda dónde

- **`~/.rastro/`** (o `$RASTRO_HOME`): lo tuyo, uno solo para toda la máquina. La configuración (`config.json`), el plan (`plan.md` y `plan.sugerido.md`), el último daily (`state.json`), los repos registrados (`repos.json`), el chat y `cron.log`.
- **`.rastro/` de cada repo registrado**: solo `events.jsonl`, los eventos de ese repo.

## Uso

`plan cambiar`, `plan sincronizar`, `daily`, `siguiente`, `start`, `publish` y `cron` corren desde cualquier carpeta. `plan <propuesta>`, `plan --sugerir`, `plan --confirmar` y `plan --desde-proyecto` (con o sin `--confirmar`) hay que correrlos dentro de un repo registrado, y `rastro init` se corre una vez por repo. Desde la raíz de este repo:

```bash
node backend/bin/rastro.js init --equipo "AI Day"    # registra este repo e instala sus hooks (crea ~/.rastro/ si falta)
node backend/bin/rastro.js plan propuesta.md         # arma la propuesta ~/.rastro/plan.sugerido.md (no toca plan.md)
node backend/bin/rastro.js plan --desde-proyecto     # sugiere el plan desde la propuesta, el intent y el git del repo
node backend/bin/rastro.js plan --confirmar          # la vuelve el plan vigente (~/.rastro/plan.md)
node backend/bin/rastro.js plan cambiar duracion bitacora 4d --confirmar  # vista previa sin --confirmar
git commit -m "[Pendientes] detector"                # [Tarea] vincula el commit con la tarea
node backend/bin/rastro.js daily                     # bitácora, pendientes, desvíos y resumen
node backend/bin/rastro.js serve                     # central en http://127.0.0.1:4317
node backend/bin/rastro.js seed-demo                 # compañeros de ejemplo para la vista de equipo
node backend/bin/rastro.js publish                   # muestra qué sale, pide confirmación y publica
```

Desde otro repo, llamá a la ruta absoluta de `backend/bin/rastro.js`. Otras opciones: `plan --sugerir`, `--semana-que-viene` en `plan <propuesta>`, `plan --desde-proyecto`, `plan --confirmar` y `plan cambiar --propuesta` (el plan del lunes que viene), `plan cambiar duracion|dia|estado|repo|vinculo|ofrecimiento <tarea|sha|id> <valor> [--propuesta] [--confirmar]` (o `plan cambiar --json`, que lee los cambios por stdin y no admite más argumentos), `daily --desde AAAA-MM-DD`, `publish --yes`, `start [--puerto N] [--sin-navegador]`, `serve --puerto N --datos dir [--personal]` (con `--personal`, el central muestra tu `state.json` global, aplica cambios al plan y abre un chat sobre `claude -p`, que corre en `~/.rastro/` y solo propone), `seed-demo --central url`.

## Uso personal

En el orden en que se usa:

1. **Plan de la semana.** `rastro plan propuesta.md` propone tareas con duración y días en `~/.rastro/plan.sugerido.md`. `rastro plan --desde-proyecto [--propuesta <archivo>] [--confirmar]` las sugiere desde el estado del proyecto (la propuesta, el intent y el git del repo). Corregí con `rastro plan cambiar duracion|dia|estado|repo|vinculo|ofrecimiento <tarea|sha|id> <valor>` (vista previa sin `--confirmar`; con `--propuesta` cambia la propuesta y no el plan vigente) y dejalo vigente con `rastro plan --confirmar` (las tareas de `plan <propuesta>` llevan el repo donde lo corrés, y confirmar reemplaza solo las tareas de los repos que trae la propuesta, desde la carpeta que sea: conserva las de los otros repos y las sin repo, y dice qué quitó; o con `rastro plan --desde-proyecto --confirmar` si la propuesta salió de `--desde-proyecto`). `rastro plan --sugerir` guarda ofrecimientos de tareas para el trabajo que quedó fuera del plan; el plan no cambia hasta que los aceptás con `plan cambiar ofrecimiento <id> aceptar`. Cada tarea puede llevar `· repo:<nombre>` para decir de qué repo es (`rastro plan cambiar repo <tarea> <nombre|ninguno>`). Si llevás el plan en Notion, `rastro plan sincronizar [--confirmar] [--usar notion|rastro]` lo deja igual en los dos lados: sin `--confirmar` muestra la vista previa. El plan de Notion se lee en el formato que tenga la página: en modo `claude`, `claude -p` (solo lectura) extrae las tareas de la semana, y si una tarea trae un proyecto como etiqueta (el "Hunting AI v2" en negrita, por ejemplo), toma el repo registrado que se le parece y el nombre sale del resto de la línea. Al publicar se respeta el formato de la página: se aplican solo los cambios (tareas agregadas, sacadas y campos cambiados) conservando sus etiquetas, su orden y su estilo, y se agrega el bloque completo únicamente si la página no tiene el plan de esta semana. El `daily` solo adopta el plan de Notion si agrega tareas o cambia duraciones, días o estados, y lista lo que cambió; si saca tareas o repos, avisa las diferencias y lo decidís con `rastro plan sincronizar --usar notion`.
2. **Disponibilidad.** En `~/.rastro/config.json`, `disponibilidad` tiene `horasDia` (horas de trabajo por día), `dias` (los días que trabajás, como `lun`, `mar`, `mie`, `jue`, `vie`), `fijos` (horas ocupadas cada día, p. ej. reuniones) y `excepciones` (horas ocupadas en una fecha puntual). Las duraciones llevan `h` (horas) o `d` (días): `4h`, `1,5d`. Un día vale las horas libres de ese día.
3. **Atraso y aviso.** Una tarea pendiente cuyo último día sugerido ya pasó está atrasada. Tras cada commit sale el aviso de desvío (el hook de git, o el del plugin dentro de Claude Code). `rastro aviso` lo imprime a demanda y `rastro siguiente` muestra la tarea actual, la siguiente, las atrasadas y lo que no entra, sin LLM ni red.
4. **Dashboard.** Necesita `frontend/dist` construido (`cd frontend && npm install && npm run build`), de la misma versión que la CLI (el build deja `dist/version.txt`; `rastro start` avisa por stderr si no coincide); sin él, `serve` solo ofrece la API. `rastro start` levanta el central personal y abre el dashboard en tu navegador (`--puerto N`, `--sin-navegador`; si ya corre uno, solo lo abre). Es un solo dashboard con todos tus repos. Desde Claude Code lo pedís hablando ("mostrame el dashboard", "quiero ver el Gantt") o con `/rastro:dashboard`, que lo levanta en segundo plano atado a la sesión; `rastro start` es el camino desde la terminal. `rastro serve --personal` hace lo mismo sin abrir el navegador: muestra tu `state.json` en http://127.0.0.1:4317, con edición directa del plan (vista previa y confirmación) y el chat.
5. **Chat.** Propone cambios con vista previa y nunca aplica: aplicar es un paso aparte que confirmás vos. Guarda la sesión en `~/.rastro/chat.json` y la retomás en la terminal con `claude --resume <id>` (el comando aparece en la pestaña Chat). Cada mensaje usa tu cuenta de Claude. No escribas en la misma sesión desde dos lados a la vez.
6. **Plugin.** `claude --plugin-dir <ruta>/plugin` (ver `plugin/README.md`). Trae `/rastro:plan`, `/rastro:siguiente`, la skill `rastro` y los hooks de fin de sesión, de aviso tras un `git commit` y de contexto al abrir la sesión: si el repo está registrado, Claude Code arranca sabiendo `rastro siguiente` (sin LLM ni red; no lee Notion, para eso `plan sincronizar`).
7. **Para pegar.** `rastro daily --para-pegar [tarea]` imprime la bitácora del último daily, por tarea o de una sola, lista para pegar en otro lado.
8. **Cerrá el día.** Con el plugin, decile a Claude "cerrá el día" (o "terminé X", "el update de hoy", "qué hice hoy", "armá la daily"): corre `rastro daily`, resume qué hiciste, qué sigue y los desvíos, y ofrece `rastro daily --para-pegar` para pegar en TaskFlow y `rastro publish`, que solo corre con tu OK explícito. Si el daily de hoy ya corrió por cron, lee lo que hay y no lo repite. Al final te pregunta si te abre el dashboard.
9. **Daily automático.** `rastro cron instalar [--hora HH:MM]` lo instala con el programador de tu máquina, sin `sudo` ni paquetes: un timer de systemd de usuario en Linux (`~/.config/systemd/user/rastro-daily.{service,timer}`, con `Persistent=true`), un LaunchAgent en macOS (`~/Library/LaunchAgents/ar.rastro.daily.plist`) o, si no hay ninguno, una sola línea global en `crontab` (`# rastro:global`). Corre `rastro daily` de lunes a viernes (18:30 por defecto) para todos tus repos y deja la salida en `~/.rastro/cron.log`; fija `RASTRO_HOME`, el `PATH` y `CLAUDE_CONFIG_DIR` (si la tenés definida). Reinstalar reemplaza la tarea, y saca las líneas de Rastro del `crontab` (también las viejas de cada repo). Con systemd, sin la sesión iniciada hace falta `loginctl enable-linger`, que Rastro solo sugiere. Si no hay ningún programador, lo dice y explica qué instalar, sin fallar. `rastro cron quitar` la saca y `rastro cron` muestra el programador, si está instalado y a qué hora, y avisa si quedan líneas viejas por repo. Necesita `rastro init` y `claude` en el PATH. Es lo único que toca fuera de `~/.rastro/` y de los repos, y solo cuando corrés el comando. Cada daily usa tu cuenta de Claude y cuesta alrededor de 1 centavo por día.

## Privacidad

- Los secretos (`sk-…`, `ghp_…`, `AKIA…`, `Bearer …`, `*_TOKEN=`, `password=`) se redactan antes de llamar al LLM y antes de cualquier conector (`rastro publish`). El `~/.rastro/state.json` local no se redacta.
- Las sugerencias de automatización salen de tu terminal y no se comparten salvo que pongas `compartir.sugerencias: true` en `~/.rastro/config.json`.
- El central escucha solo en localhost: no tiene autenticación todavía. En modo personal (`--personal`), los POST (`/api/cambios` y `/api/chat`) llevan el token de sesión en `X-Rastro-Token`, y se rechazan el host y el origen que no sean locales.
- El chat manda a `claude -p` el plan vigente y un resumen del último daily con las últimas entradas de la bitácora, ya redactados de secretos. Eso sale de tu máquina hacia Claude con tu cuenta.

## Configuración

`~/.rastro/config.json` (lo crea `init` si no existe, una sola para todos tus repos): persona, zona horaria, conectores (`central`, `notion`), umbrales de pendientes, desvíos y repeticiones (`umbrales.atrasadas` es cuántas tareas atrasadas disparan la alerta de desvío, 1 por defecto), el LLM (`claude-cli` con `haiku` por defecto, o `ninguno`) y `chat.modelo` (el modelo del chat, `sonnet` por defecto).

`notion.modo` es `mock` (por defecto: escribe `~/.rastro/notion-preview.md`) o `claude` (publica en la página Daily con `claude -p`, usando la skill daily-flock instalada en `~/.claude/skills/daily-flock`). En modo `claude`, `claude -p` corre solo con la skill daily-flock y las dos herramientas de Notion (`notion-fetch` y `notion-update-page`), y cuesta unos centavos por publicación; para leer el plan usa la skill, `notion-fetch` y `notion-search`, sin ninguna herramienta que escriba. `notion.pagina` (opcional) es el id de una página de Notion (32 caracteres hexadecimales, con o sin guiones): en modo `claude`, publica al final de esa página en vez de la Daily.

## Limitaciones conocidas

- El hook post-commit llama a `node` del PATH. Con gestores de versiones como fnm, los commits hechos desde clientes gráficos pueden no registrar el evento; la bitácora basada en git sigue funcionando.
- El chat corre con `--restricted`, que ignora `~/.claude/settings.json`: quien se autentique con `apiKeyHelper` o con variables definidas ahí necesita las credenciales por otra vía.
- Si una versión nueva de `claude` cambia el mensaje de "sesión no encontrada", una sesión perdida deja el chat con error hasta la semana siguiente.
- El snapshot tiene una sola fecha, la del último `rastro daily`: después de cambiar el plan (en el dashboard, con `plan cambiar` o con `plan --confirmar`) se rehacen el plan, la bitácora vinculada, los desvíos, el foco y el Gantt, pero el atraso y el foco siguen a esa fecha hasta el próximo `daily`. Si hoy cae en otra semana que el último `daily`, no se rehace nada y se avisa que corras `rastro daily`.
- "Resuelto sin cerrar" asume merge commits (`--no-ff` o merges de PR): los merges squash o fast-forward todavía no se detectan.

## Modo equipo

La versión del AI Day está en la rama `ai-day` (tag `ai-day-2026`). `main` es la continuación personal
(ver `intent/asistente-personal/intent.md`).

El central multipersona, la vista Equipo, `seed-demo` y `publish` siguen funcionando y están en pausa. Lo que cambió: el snapshot es v2 (suma `foco`, `ofrecimientos`, el plan con duraciones y días, y el vínculo `corregido`; el central sigue aceptando v1), `desvios.alerta` también se levanta por tareas atrasadas, y `publish` puede sumar el bloque del plan a Notion, siempre con confirmación.

## A futuro

Lo que sigue pendiente (ver `intent/asistente-personal/intent.md`):

- **Aprender del historial.** Afinar las duraciones sugeridas con lo que ya pasó: dailies,
  checkpoints y bitácora. Es una "proto persona" del estilo de un second brain, quizás guardada en
  SQLite.
- **Notas de reuniones.** Conectar un sistema de toma de notas, que sería otro servicio, para sumar
  lo que se habla en las reuniones.
- **Filtro por autor.** En un repo compartido, contar solo los commits propios (`git config user.email`).
- **Merges squash o fast-forward.** Detectarlos como "resuelto sin cerrar".
- **Puente con daily-flock.** Que la skill tome la bitácora de `rastro daily --para-pegar`.
- **Uso de equipo.** Retomar el central multipersona con un dashboard de admin que muestre lo de cada
  persona.

## Desarrollo

```bash
cd backend && npm install && npm run check    # tsc estricto + node --test
```

El contrato entre el motor y la UI está en `intent/spec.md` (sección "Contrato") y en `backend/src/contract/snapshot.ts`. El pedido de la UI está en `frontend/README.md`.
