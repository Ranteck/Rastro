# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vite + TypeScript estricto, sin framework (elegido por Denis el 2026-10-09). Vive en `frontend/`. El
build es estático y queda en `frontend/dist/` con `index.html` en la raíz; `rastro serve` lo sirve tal
cual, desde el mismo origen que la API.

## Users

- **Desarrollador (primario; primero Denis).** Al final del día, o mientras trabaja, quiere ver qué
  hizo, qué le quedó pendiente y qué podría automatizar, y decidir qué comparte. Si sus necesidades
  chocan con las de otro usuario, ganan las suyas: el dato es de él.
- **Líder de equipo.** Quiere saber qué está resuelto y quién se desvía del plan, sin preguntarle a
  nadie. Entra por la vista Equipo.
- **Jurado del Flock AI Day 2026 (2026-10-09).** Ve una demo de 5 minutos en proyector y tiene que
  entenderla de un vistazo. Es una audiencia de hoy, no un usuario permanente.
- El intent también nombra a cliente y dirección como afectados. Para el dashboard todavía no hay
  vistas pensadas para ellos.

## Product Purpose

Rastro arma la memoria del equipo sola. Cruza lo que pasó en el código (commits, ramas, merges,
sesiones de Claude Code, terminal) con el plan de la semana. Muestra qué está resuelto, qué está
pendiente y con qué evidencia, y sugiere automatizar lo que se repite. Busca reducir la supervisión
manual de lo que ya está resuelto. Deja de hacer falta que el líder pregunte "¿esto está?" o que la
daily se arme a mano.

El dashboard es la cara del central (`rastro serve`): la persona ve su día y el líder ve al equipo.
Hay éxito cuando lo resuelto se ve sin que nadie lo informe y el trabajo sin ticket deja de ser
invisible.

## Positioning

Frase gancho: *"Está resuelto en el código; nadie cerró el ticket."*

Rastro no le pide a nadie que cargue nada. Lee la evidencia que ya existe en git y en las
herramientas de trabajo y la contrasta con el plan. La detección es determinística y el LLM solo
resume y propone. La CLI no corre todo el tiempo: se activa en momentos concretos (post-commit, fin de
sesión de Claude Code, `rastro daily`). Cada persona decide qué publica.

## Operating Context

- Lo que lo dispara es la CLI de cada persona: el post-commit (solo anota el evento), el fin de sesión
  de Claude Code y `rastro daily`, a demanda o por cron. `rastro publish` envía el snapshot al
  central o a Notion.
- El dashboard lo sirve el central local (`127.0.0.1:4317`) y lee dos endpoints:
  `GET /api/equipo` y `GET /api/persona/:id`. El contrato es `schemaVersion: 1` en
  `intent/spec.md`, sección "Contrato".
- Vistas pedidas (en `frontend/README.md`):
  1. **Equipo:** es el inicio.
  2. **Mi día:** el resumen en Hice, Avancé, Sigue y Bloqueos, la bitácora y el costo.
  3. **Pendientes:** "resuelto sin cerrar" es el protagonista.
  4. **Plan:** con los desvíos y el Gantt plan vs. real.
  5. **Sugerencias.**
- Rituales que reemplaza o alimenta: la daily, el cierre de semana con el líder y la página Daily de
  Notion (skill daily-flock).
- Se va a mostrar en proyector durante la demo del AI Day.

## Capabilities and Constraints

- **Estados que la UI tiene que cubrir:**
  - `resumen: null`: se muestra "Sin resumen" y el resto normal.
  - `plan: null`: la persona no tiene plan esta semana.
  - `gantt.mock: true`: va con una etiqueta visible "mock" o "visión".
  - `desvios.alerta: true`: se ve en Equipo y en Plan.
  - Evidencia sin `url`: se muestra la `ref` sin link.
  - Listas vacías: una frase, no una tabla en blanco.
  - Persona inexistente: 404.
- **Vínculo de cada entrada de bitácora:** `✓ tarea` (por el tag), `~ inferido` (con su razón) o
  `sin tarea`.
- **Sugerencias:** el `contenido` es código y necesita un bloque copiable. No se comparten por
  defecto, así que en el central la lista suele venir vacía.
- **Red:** sin llamadas a servicios externos. Solo habla con `/api/*` del mismo origen y la demo
  corre sin red.
- **Temas:** claro y oscuro. Tiene que leerse bien en un proyector.
- **Gantt:** en esta versión es mock por diseño. Tiene que poder continuarse después del AI Day.
- **Terminología:** bitácora, pendiente, resuelto sin cerrar, desvío, fuera del plan, tarea
  fantasma (barra con `plan: null` y `real`), sugerencia, snapshot, central y conector.
- **Sin decidir:** qué agrega la vista Equipo para cliente o dirección, y si va a haber
  autenticación cuando el central deje de ser local.

## Brand Commitments

- Rastro es marca propia, sin lineamientos de Flock IT obligatorios (confirmado por Denis el
  2026-10-09).
- Todos los textos van en castellano rioplatense con voseo. La voz es directa y concreta, como la
  frase gancho.
- No hay logo ni otros assets de marca.

## Evidence on Hand

- `frontend/ejemplos/equipo.json` y `frontend/ejemplos/persona-denis.json`: cumplen el contrato y los
  valida el test del motor, así que sirven como mock.
- `rastro seed-demo`: publica compañeros ficticios (Tomás, Lucía, Sofía) para la vista Equipo.
- La corrida real del 2026-10-09 sobre este repo dio 49 entradas de bitácora, 1 pendiente, 92% fuera
  del plan con alerta y 4 tareas sin actividad, con un costo de US$0.0137. También quedó publicada en
  la página "AI Day" de Notion.
- No hay testimonios, clientes, métricas de uso ni casos de estudio: no se inventan. Los compañeros
  de `seed-demo` son ficticios y no se presentan como reales.

## Product Principles

1. **Evidencia antes que afirmación.** Todo lo que el dashboard dice lleva su link o su ref (commit,
   PR, doc). Si no hay evidencia, no se afirma.
2. **El dato es del desarrollador.** No es vigilancia: lo que la persona no compartió no aparece, y la
   UI no lo presenta como una falta.
3. **Lo detectado y lo inferido se distinguen.** La detección determinística, la inferencia del LLM
   y lo que falta (`sin tarea`, `Sin resumen`) se ven distintos y nunca se mezclan.
4. **Honesto sobre lo que es mock.** Lo que todavía es visión (el Gantt) se etiqueta como tal.
5. **Se entiende de un vistazo y sin red.** Lo importante (resuelto sin cerrar, alerta de desvío) se
   lee de lejos en un proyector, y todo funciona offline.

## Accessibility & Inclusion

- Claro y oscuro, con lectura cómoda en proyector. Esto es un requisito explícito del pedido de UI.
- No se fijó un estándar formal (WCAG u otro).
