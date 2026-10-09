# Spec: Rastro (desde intent.md 2026-10-09)
Estado: aceptado · Fecha: 2026-10-09

Diseño acordado en brainstorming. Cada requisito cita su origen en `intent/intent.md`.

## Alcance de esta spec

- Motor y CLI `rastro` en TypeScript estricto, ejecutado por Node 22 sin build (type stripping).
  Sin dependencias en runtime; `typescript` como única dependencia de desarrollo.
- El central (`rastro serve`): API HTTP y servidor de archivos estáticos.
- **La UI del dashboard no se construye acá.** La diseña Denis aparte a partir del pedido en
  `frontend/README.md`. El central sirve lo que haya en `frontend/dist/`.

## Arquitectura

```
 disparadores                fuentes (ya existen)          .rastro/ (en cada repo)
 git post-commit ─┐          git log / ramas               events.jsonl  ← solo se agrega
 Claude SessionEnd┼► rastro hook  (sin LLM) ─────────────►  plan.md      ← formato daily-flock
 rastro daily/cron┘                                         config.json
                                                            state.json   ← CONTRATO
 rastro daily:  colectores ─► detectores ─► LLM ─► state.json ─► rastro publish ─► conectores
                                                                                 ├─ central (HTTP)
 rastro serve = central: POST /api/publish ─► datos por persona ─► UI            └─ Notion
```

| Unidad | Qué hace | Interfaz |
| --- | --- | --- |
| Colectores | Leen git, `plan.md`, historial de zsh y transcripts de Claude Code; los parsean a tipos al entrar. | `collect(periodo) → Evento[]` |
| Detectores | Determinísticos: vínculo, pendientes, desvíos, repeticiones. | funciones puras sobre eventos y plan |
| LLM | Resume, propone vínculos inferidos, arma el plan, propone automatizaciones. | `complete(prompt, esquema) → JSON validado` |
| Conectores | Publican el snapshot. | `publish(snapshot) → resultado` |
| Central | Recibe snapshots, los guarda por persona y sirve la UI. | HTTP (ver Contrato) |

Implementaciones para la demo: LLM `ClaudeCli` (`claude -p --output-format json`, sin herramientas
habilitadas, toma costo y tokens de la respuesta). Conectores `central` y `notion`.

`.rastro/` se agrega a `.git/info/exclude` al hacer `init`: es local de cada persona y no ensucia el repo.

## Comandos

| Comando | Efecto |
| --- | --- |
| `rastro init` | Crea `.rastro/` y `config.json`, instala el post-commit y el hook `SessionEnd` del proyecto. |
| `rastro hook commit` / `rastro hook session-end` | Agregan un evento a `events.jsonl`. Los llaman los hooks. |
| `rastro plan <propuesta.md>` / `rastro plan --sugerir` | Arma `plan.md` desde una propuesta, o sugiere tareas nuevas (REQ-18). |
| `rastro daily [--desde AAAA-MM-DD]` | Corre colectores, detectores y LLM; escribe `state.json`; imprime el resumen. |
| `rastro publish [--yes]` | Muestra qué va a salir, pide confirmación y publica en los conectores. |
| `rastro serve [--puerto] [--datos <dir>]` | Levanta el central. |
| `rastro seed-demo` | Publica en el central 2 o 3 compañeros mock. |

## Requisitos

- REQ-1 MUST: `rastro init` instala el post-commit y el hook `SessionEnd` de Claude Code sin pisar
  hooks ni settings existentes (los encadena o los mergea). Origen: Resultado esperado, "post-commit
  (solo anota el evento), fin de sesión de Claude Code".
- REQ-2 MUST: Los hooks solo agregan un evento: no llaman al LLM y nunca hacen fallar el commit ni la
  sesión; ante un error lo anotan en `.rastro/errors.log` y salen con 0. Origen: Restricciones, "no
  corre todo el tiempo"; Resultado esperado, "solo anota el evento".
- REQ-3 MUST: `rastro daily` arma la bitácora del período: entradas por tarea con la rama y la
  evidencia (commit, rama, doc o sesión, con URL si el repo tiene remoto). Origen: Resultado esperado,
  "Bitácora del día a día con evidencia (...), separada por rama y tarea".
- REQ-4 MUST: El vínculo commit → tarea es primero determinístico (slug de la tarea en la rama o
  `[Nombre]` en el mensaje). Sin match, el LLM propone una tarea con su razón y queda marcado
  `inferido`; si tampoco, `sin-tarea`. Origen: Restricciones, "Detección determinística; el LLM solo
  resume y propone".
- REQ-5 MUST: Detecta pendientes con evidencia y próximo paso: resuelto sin cerrar (rama de la tarea
  mergeada a la rama principal, o commit con `cierra [Nombre]`, y tarea sin tildar), cerrado sin
  evidencia, rama sin mergear y quieta (N días, por defecto 3), TODO/FIXME nuevo y código sin doc (commits que tocan
  código y no `README` ni `docs/`). Origen: Resultado esperado, "Pendientes (...) con próximos pasos";
  Problema, "código, tareas y documentación".
- REQ-6 MUST: `rastro plan <propuesta.md>` escribe `.rastro/plan.md` con el formato `## Plan semana
  DD/MM` de daily-flock (entregable y tareas `- [ ] **Nombre:** objetivo`). Si ya hay plan, no lo pisa:
  escribe `plan.sugerido.md`. Origen: Resultado esperado, "un plan que se arma solo desde una
  propuesta"; Restricciones, "Reutilizar daily-flock".
- REQ-7 MUST: Calcula desvíos: % de commits del período fuera del plan, con alerta sobre un umbral (por defecto
  50%) y tareas del plan sin actividad. El resumen lista lo que quedó sin resolver. Origen: Resultado
  esperado, "al final del día avisa qué quedó sin resolver y detecta (...) desvíos".
- REQ-8 SHOULD: El post-commit imprime una línea de aviso si el commit no tiene tarea y el día ya
  supera el umbral de desvío. Origen: Resultado esperado, "detecta desde el principio".
- REQ-9 MUST: Detecta repeticiones en zsh (secuencias de 1 a 4 comandos normalizados en 10 minutos,
  sin triviales) y en prompts de Claude Code (iguales o con al menos 80% de palabras en común), con
  umbral configurable (por defecto 3 veces en 2 días). El LLM propone alias, script, hook o skill con
  el porqué. Origen: Resultado esperado, "Sugerencias de automatización".
- REQ-10 MUST: El LLM escribe el resumen (hice, avance, sigue, bloqueos) y las entradas de la
  bitácora a partir de los diffs. Sin LLM, el resumen queda `null` y las entradas usan el asunto del
  commit; pendientes y desvíos salen igual. Origen: Problema, "arme un resumen con evidencia y
  próximos pasos"; Restricciones, "el LLM solo resume y propone".
- REQ-11 MUST: El LLM se usa solo a través de su interfaz; cambiar de proveedor no toca detectores
  ni conectores. Se registran llamadas, costo y tokens. Origen: Restricciones, "La IA (...) tiene que
  poder reemplazarse".
- REQ-12 MUST: Nada sale de la máquina sin `rastro publish`, que muestra el contenido y pide
  confirmación. Las sugerencias no se comparten por defecto (`compartir` en `config.json`). Origen:
  Restricciones, "cada persona decide qué comparte".
- REQ-13 MUST: Antes de llamar al LLM o a un conector se redactan secretos (`sk-`, `ghp_`, `AKIA`,
  `xox`, `Bearer`, `*_KEY=`, `*_TOKEN=`, `password=`). Al LLM nunca va historial crudo. Origen:
  Restricciones, "No es vigilancia".
- REQ-14 MUST: El central valida cada snapshot contra el contrato, rechaza campos no admitidos con 400,
  guarda el último por persona y expone la API del contrato. Origen: Resultado esperado, "un central
  propio, que recibe lo de cada persona y sirve un dashboard".
- REQ-15 SHOULD: El conector `notion` publica en la Daily corriendo `claude -p` con la skill
  daily-flock y solo herramientas de Notion. Si el modo headless no tiene acceso, queda como conector
  mock que escribe una vista previa local. Origen: Resultado esperado, "y Notion, como ya hace
  daily-flock"; Preguntas abiertas.
- REQ-16 MUST: El contrato es versionado (`schemaVersion`) y tiene un validador; los ejemplos de
  `frontend/` y los datos de `seed-demo` lo cumplen. El Gantt viaja con `mock: true`. Origen:
  Resultado esperado, "salvo el Gantt, que es mock. Tiene que poder continuarse después".
- REQ-17 MUST: `rastro seed-demo` publica 2 o 3 compañeros ficticios para la vista de equipo.
  Origen: Resultado esperado, "recibe lo de cada persona"; Cambios 2026-10-09.
- REQ-18 MAY: `rastro plan --sugerir` propone tareas nuevas a partir del trabajo fuera del plan y de
  los pendientes. Origen: Resultado esperado, "o sugiriendo ideas".

## Contrato

```ts
type Fecha = string;            // "2026-10-09"
type Evidencia = { tipo: "commit" | "rama" | "doc" | "sesion"; ref: string; url?: string };
type Snapshot = {
  schemaVersion: 1; generadoEn: string /* ISO con zona */;
  persona: { id: string; nombre: string; equipo: string };
  repo: { nombre: string; url?: string };
  periodo: { desde: Fecha; hasta: Fecha };
  plan: null | { semana: Fecha /* lunes */; entregable: string;
    tareas: { slug: string; nombre: string; objetivo: string;
              estado: "pendiente" | "hecha" | "sacada" }[] };
  bitacora: { fecha: Fecha; hora: string /* "HH:MM" */; tarea: string | null /* slug */;
    rama: string; texto: string; vinculo: "nombre" | "inferido" | "sin-tarea";
    razon?: string /* solo si inferido */; evidencia: Evidencia[] }[];
  pendientes: { tipo: "resuelto-sin-cerrar" | "cerrado-sin-evidencia" | "rama-quieta"
      | "todo-nuevo" | "codigo-sin-doc";
    tarea: string | null; texto: string; evidencia: Evidencia[]; proximoPaso: string }[];
  desvios: { fueraDelPlanPct: number; alerta: boolean; tareasSinActividad: string[] };
  resumen: null | { hice: string[]; avance: string[]; sigue: string[]; bloqueos: string[] };
  sugerencias: { fuente: "zsh" | "claude-code"; patron: string; ocurrencias: number; dias: number;
    propuesta: { tipo: "alias" | "script" | "hook" | "skill"; contenido: string; porque: string } }[];
  gantt: { mock: true; barras: { tarea: string; plan: null | { desde: Fecha; hasta: Fecha };
                                  real: null | { desde: Fecha; hasta: Fecha } }[] };
  costo: { llamadas: number; usd: number; tokens: number };
};
```

API del central:
- `POST /api/publish` con un `Snapshot` → `201 { ok: true }` o `400 { error }`.
- `GET /api/equipo` → `{ equipo: { persona, repo, ultimoUpdate, tareasHechas, tareasTotales,
  pendientesAbiertos, fueraDelPlanPct, alerta }[] }` (`tareasTotales` no cuenta las sacadas).
- `GET /api/persona/:id` → último `Snapshot` de esa persona, o `404`.
- `GET /*` → archivos de `frontend/dist/`.

## Capacidades y escenarios

### Hooks (REQ-1, REQ-2, REQ-8)
- GIVEN un repo con un post-commit propio WHEN corro `rastro init` THEN el hook original sigue
  corriendo y además se llama a `rastro hook commit`.
- GIVEN `.rastro/events.jsonl` sin permisos de escritura WHEN hago un commit THEN el commit se crea,
  y el error queda en `errors.log` o en stderr.
- GIVEN un día con 3 de 4 commits sin tarea WHEN commiteo otro sin tarea THEN el hook imprime un aviso
  de desvío.

### Pendientes y vínculo (REQ-4, REQ-5)
- GIVEN la tarea `Pendientes` sin tildar y la rama `feat/pendientes` mergeada a `main` WHEN corro
  `rastro daily` THEN aparece un pendiente `resuelto-sin-cerrar` con el commit de merge como evidencia
  y el próximo paso "Tildar Pendientes en el plan".
- GIVEN un commit "fix parser" en `main` WHEN el LLM no está disponible THEN la entrada queda
  `sin-tarea` y no `inferido`.

### Plan y desvíos (REQ-6, REQ-7)
- GIVEN un `plan.md` existente WHEN corro `rastro plan propuesta.md` THEN `plan.md` no cambia y se
  escribe `plan.sugerido.md`.
- GIVEN una tarea del plan sin commits en la semana WHEN corro `rastro daily` THEN figura en
  `tareasSinActividad` y en `resumen.sigue`.

### Repeticiones (REQ-9, REQ-13)
- GIVEN la misma secuencia de comandos 3 veces en 2 días WHEN corro `rastro daily` THEN hay una
  sugerencia con 3 ocurrencias y 2 días.
- GIVEN un comando con `GITHUB_TOKEN=ghp_xxx` WHEN se arma el prompt THEN el token no aparece.

### Resumen y LLM (REQ-10, REQ-11)
- GIVEN `claude` falla dos veces WHEN corro `rastro daily` THEN `resumen` es `null`, los pendientes
  están completos y el comando termina con 0 y un warn.

### Publicación y central (REQ-12, REQ-14, REQ-16, REQ-17)
- GIVEN un `state.json` WHEN corro `rastro publish` y respondo "n" THEN no se envía nada.
- GIVEN `compartir.sugerencias` en `false` WHEN publico THEN el snapshot llega con `sugerencias: []`.
- GIVEN un snapshot con un campo extra WHEN se hace POST THEN el central responde 400 y no lo guarda.
- GIVEN `rastro seed-demo` corrido WHEN pido `GET /api/equipo` THEN hay al menos 3 personas.

## Errores
- Hooks: nunca fallan (REQ-2). El fallback es intencional y va comentado en el código.
- Fuentes: una línea inválida de zsh o de un transcript se descarta y se cuenta en un warn. Un
  `plan.md` mal formado corta la corrida con la línea del error.
- LLM: un reintento y después degradación (REQ-10). Toda respuesta se valida contra su esquema.
- Conectores: independientes; el resultado se informa por conector. Si el central no responde, el
  snapshot queda local para reintentar `publish`.
- Salida: resultados a stdout; logs estructurados a stderr; mensajes al usuario en un solo lugar
  (la CLI).

## Tests
`node:test`, test antes que el código. Determinísticos con fixtures y repos git temporales: parser de
`plan.md`, vínculo, cada regla de pendientes, desvíos, repeticiones y redacción. `FakeLLM` para el
flujo con y sin LLM. Validador contra ejemplos válidos e inválidos, incluidos `frontend/ejemplos/` y
`seed-demo`. Central por HTTP en un puerto efímero. Post-commit en un repo temporal.

## Concerns
- El central no tiene autenticación: en la demo escucha solo en localhost. Antes de compartirlo en red
  hace falta al menos un token por equipo.
- Hay un snapshot por persona: si alguien trabaja en dos repos, el último pisa al anterior.
- No sabemos si `claude -p` en modo headless accede a los conectores de claude.ai y a las skills
  sincronizadas: se verifica con una prueba rápida antes de construir el conector de Notion (REQ-15).
- El formato de los transcripts de Claude Code es interno y puede cambiar; el colector tiene que
  tolerar campos nuevos.
- El historial de zsh solo tiene fechas desde que se activa `EXTENDED_HISTORY`: las repeticiones de
  terminal arrancan con pocos datos.
- Los diffs y prompts redactados igual salen hacia el proveedor del LLM; el modo estricto con LLM
  local queda para después.
