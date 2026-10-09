# Memoria de equipo con evidencia — Propuesta de producto

Flock AI Day 2026 · Oct 9, 2026 · @Denis Hugo Perafan

## Resumen

**Rastro** (nombre de trabajo) es un asistente que arma la memoria del equipo sola: un agente en cada máquina registra lo que se hace, y un central lo cruza con el código y las tareas para mostrar qué está resuelto, qué está pendiente y con qué evidencia.

Frase gancho: *"Está resuelto en el código; nadie cerró el ticket."* Rastro detecta eso, lo muestra con la evidencia y le ahorra al líder la ronda de preguntas para enterarse.

Suma dos cosas que un tablero de tareas no ve: el trabajo que nunca llegó a un ticket, y las tareas que la gente repite a mano y se podrían automatizar.

## Problema

El estado real del trabajo está repartido en cuatro lugares y se reconstruye a mano en un quinto.

- **Disperso.** El código está en GitHub, las tareas en Jira o en un sistema propio, la documentación en Notion y el contexto en la cabeza de cada uno. Nadie ve las cuatro cosas juntas.
- **Supervisión de lo ya resuelto.** El líder pregunta "¿esto está?" por tareas que ya están hechas en el código pero siguen abiertas en el tablero. Es tiempo de las dos partes gastado en confirmar algo que ya pasó.
- **Trabajo invisible.** Debugging, experimentos descartados, fixes de pipeline: trabajo real que nunca llega a un ticket y no aparece en ningún reporte.
- **Reportes a mano.** La daily, el cierre semanal y el informe al cliente se arman copiando de esas fuentes. Cada persona lo hace distinto y con distinto nivel de detalle.
- **Repetición que nadie mide.** La misma secuencia de pasos se hace a mano decenas de veces. Nadie lo nota porque nadie lo registra.

## Solución

Rastro funciona como un anotador de reuniones compartido: cada persona toma sus notas, las comparte, y juntas dan un perfil de lo que pasó mucho más completo que el de cualquiera por separado.

- **Un agente en cada máquina** observa la actividad local: commits, ramas, sesiones de terminal y de Claude Code. Es lo que ve el proceso, no solo el resultado.
- **Cada persona aprueba lo que comparte.** Se comparten las notas, no la grabación: los secretos se redactan localmente y nada sale sin que el dueño lo vea.
- **Un central reúne las notas de todos** y las cruza con las fuentes del equipo (GitHub, Jira, Notion). De ahí salen la bitácora, los pendientes, el Gantt y las sugerencias.

La diferencia con un dashboard de Jira: Jira muestra lo que la gente declaró. Rastro muestra lo que pasó, y marca dónde no coinciden.

## Funcionalidades

Cuatro vistas sobre la misma base de eventos; cada una responde una pregunta que hoy se contesta a mano.

| Funcionalidad | Pregunta que responde | Cómo |
| --- | --- | --- |
| Bitácora con evidencia | ¿Qué se hizo hoy, y dónde está la prueba? | Resume el diff de cada PR o push, no el mensaje del commit. Cada entrada linkea al commit, PR o doc que la respalda. Por tarea y por persona, lo más reciente arriba. |
| Detección de pendientes | ¿Qué está resuelto y nadie cerró? ¿Qué dice resuelto y no lo está? | Cruza código y tareas: PR mergeado con ticket abierto, ticket en Done sin PR, rama sin actividad hace N días, TODO/FIXME nuevos en el diff. |
| Gantt plan vs. real | ¿Vamos según lo planeado? ¿Qué trabajo no estaba en el plan? | Dos barras por tarea: plan (fechas del tablero) y real (primera y última evidencia). Marca desvíos y muestra tareas fantasma: trabajo real sin plan. Click en una barra abre su evidencia. |
| Sugerencias de automatización | ¿Qué hacemos a mano una y otra vez? | Detecta secuencias de pasos repetidas (3 o más veces, en al menos 2 días). Un LLM propone la automatización concreta (script, alias, hook o skill) y explica por qué. |

El Gantt no inventa estimaciones: el plan sale de las fechas que el equipo ya cargó, y lo real sale de la evidencia. La detección de repeticiones es determinística; el LLM solo interviene para proponer qué hacer con el patrón.

## Arquitectura

&#91;embedded content: arquitectura · agente local y central\]

Cada máquina procesa su actividad localmente y solo envía lo que su dueño aprobó. El central agrupa por SHA, PR y ticket antes de que el LLM combine las narrativas, así dos personas que tocaron el mismo PR no generan entradas duplicadas.

## Propuesta de valor y modelo de negocio

Rastro se valida primero adentro de Flock y después se ofrece a clientes como producto o como servicio de implementación.

**Para quién**

| Usuario | Qué gana |
| --- | --- |
| Líder de equipo / PM | Sabe qué está resuelto sin preguntar. Ve desvíos antes de la reunión, no en ella. |
| Desarrollador | Su daily y su cierre semanal se arman solos. Su trabajo invisible queda registrado. Recibe sugerencias para dejar de repetir tareas. |
| Cliente | Un informe de avance con evidencia verificable, no un resumen redactado a mano. |
| Dirección | Visibilidad del trabajo real por proyecto, comparable entre equipos. |

**Modelo de negocio (hipótesis a validar)**

1. **Uso interno en Flock.** Piloto con uno o dos equipos. Sirve para medir el impacto real antes de venderlo.
2. **Producto para clientes.** Licencia por usuario por mes, con el central en la nube del cliente o de Flock.
3. **Servicio de implementación.** Flock conecta Rastro a las herramientas del cliente (su Jira, su sistema de tareas, su repositorio) y configura las reglas de pendientes. Encaja con la oferta actual de consultoría.

**Métricas de impacto a medir en el piloto**

- Horas por semana dedicadas a armar dailies, cierres e informes, antes y después.
- Cantidad de tickets resueltos en código que seguían abiertos, y cuánto tiempo llevaban así.
- Porcentaje del trabajo real que no tenía ticket (trabajo invisible).
- Automatizaciones sugeridas que el equipo efectivamente adoptó.

No hay números todavía: la primera tarea del piloto es medir la línea base.

## Diferenciales y riesgos

El diferencial es ver el proceso y no solo el resultado; el riesgo principal es que se perciba como vigilancia.

**Diferenciales**

- **Evidencia, no declaración.** Cada afirmación de la bitácora linkea a un commit, PR o documento.
- **Detecta lo que nadie reportó:** tareas resueltas sin cerrar y trabajo sin ticket.
- **Sugiere automatizaciones** a partir de lo que la gente hace de verdad, no de lo que dice que hace.
- **No cambia el flujo de trabajo.** Lee git, terminal y tablero; nadie tiene que cargar nada nuevo.

**Riesgos y mitigación**

| Riesgo | Mitigación |
| --- | --- |
| Se percibe como monitoreo de empleados | Local-first: cada uno aprueba lo que comparte. Se comparten resúmenes, no eventos crudos. |
| Secretos en el historial de terminal (tokens, keys) | Redacción local antes de cualquier envío. |
| Commits con mensajes pobres ("fix", "wip") | Se resume el diff, no el mensaje. |
| Hashes que cambian con rebase o squash | La unidad estable es el PR mergeado; el commit es detalle. |
| Costo de LLM por evento | El LLM solo resume y propone; detección y cruce son determinísticos. |

## Demo del AI Day

La demo es un dashboard con datos hardcodeados que muestra el producto completo; la parte real, si da el tiempo, es el detector de repeticiones sobre historial verdadero.

| Pieza | En la demo |
| --- | --- |
| Dashboard: bitácora, pendientes, Gantt plan vs. real, sugerencias | Mock con datos creíbles |
| Detector de repeticiones sobre historial de terminal y git | Real, si llega |
| Propuesta de automatización con `claude -p` | Real, si llega |
| Agente por máquina, central, sync con Jira/Notion | Solo en la propuesta |

**Guion (5 minutos)**

1. **El problema en una frase:** "¿Cuántas veces esta semana preguntaste si algo estaba hecho, y ya lo estaba?"
2. **Pendientes:** un ticket abierto con su PR mergeado al lado. "Está resuelto; nadie lo cerró."
3. **Gantt plan vs. real:** una tarea atrasada con su evidencia, y una tarea fantasma que no estaba en el plan.
4. **Bitácora:** la daily de una persona armada sola, cada línea con su link.
5. **Repeticiones:** una secuencia detectada y la automatización propuesta.
6. **Cómo funciona y privacidad:** el diagrama, y la frase "cada uno comparte sus notas, no la grabación".

## Roadmap

Cuatro fases; cada una se habilita cuando la anterior demuestra valor con datos reales.

1. **Prototipo (AI Day).** Dashboard mock y detector de repeticiones sobre historial real.
2. **Uso personal.** Agente local con bitácora desde git y sesiones de Claude Code, escribiendo en Notion. Valida que los resúmenes sirvan.
3. **Piloto de equipo en Flock.** Central, merge por IDs estables (SHA, PR, ticket), cruce con el sistema de tareas y detección de pendientes. Se mide la línea base de las métricas de impacto.
4. **Producto.** Gantt plan vs. real con alertas de desvío, conectores para Jira y GitHub de clientes, y modo estricto con LLM local: nada crudo sale de la máquina.

## Cobertura del rubro

Rastro toca los siete ejes del rubro del AI Day; la columna de la derecha dice si está en la demo o en la propuesta.

| Eje | Cómo lo cubre | Estado |
| --- | --- | --- |
| Orquestación | Pipeline de collectors, redacción, resumen, aprobación y merge central, con jobs separados para bitácora y patrones | Propuesta |
| MCP | Conectores a GitHub, Jira y Notion vía MCP desde el central | Propuesta |
| RAG | Búsqueda sobre la bitácora y la documentación del equipo para responder "¿qué se hizo con X?" | Propuesta |
| Observabilidad | Telemetría OpenTelemetry de Claude Code: tokens, costo y latencia por llamada | Propuesta |
| Seguridad | Local-first, redacción de secretos, aprobación del usuario, herramientas de solo lectura | Propuesta |
| Costo | El LLM solo resume y propone; detección y cruce sin IA | Demo, si llega el detector |
| Impacto de negocio | Menos supervisión de lo ya resuelto, reportes automáticos, trabajo invisible visible | Demo |
