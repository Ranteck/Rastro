---
version: 1
slug: "frontend-index-html"
primary_target: "frontend/index.html"
related_targets: []
---

# Dashboard de Rastro (frontend/)

## Alcance y modo
Modo Operate. Las cinco vistas de `intent/frontend/spec.md`: Equipo (inicio), Mi día, Pendientes,
Plan con Gantt y Sugerencias. Se construye en código.

## Audiencia y tarea
- El desarrollador es primario y entra directo a su Mi día.
- El líder entra por Equipo.
- El jurado del AI Day lo ve en un proyector.

La tarea es ver qué está resuelto, qué quedó pendiente y con qué evidencia. El momento para recordar
es la lámina de "resuelto sin cerrar" con su sello.

## Decisiones abiertas
Ninguna de producto. El orden de las vistas sigue la demo: si Plan o Sugerencias no llegan, quedan con
datos mock y etiquetadas (REQ-14).

## Direction contract
THESIS: Rastro es una sección de láminas de un anuario. Cada persona y cada pendiente es una lámina
registrada, y lo resuelto sin cerrar lleva un sello impreso. Rechaza el dashboard SaaS de sidebar
gris, tarjetas KPI y donas.

OWN-WORLD: el papel es #F5F4F6, se entibia a #FAF6F5 y se enfría a #EEF3EF en los bordes. La tinta es
#16181A y las hairlines de 1px son #C9C7C4. El sello lavanda #DCDDF3 se usa solo para "resuelto sin
cerrar". La alerta es una placa invertida de tinta con un bermellón accesible. Un grotesco
(Schibsted Grotesk 400/500) en todo y mono (JetBrains Mono) en mayúsculas para etiquetas, SHA y horas,
a 13px como mínimo. Cruces de registro en las esquinas de las láminas. Radio 0.

STORY: el visitante ve primero quién está desviado y qué quedó resuelto sin cerrar. Cree en lo que ve
porque cada afirmación lleva su SHA. Abre la persona, mira su día y copia una automatización.

FIRST VIEWPORT: barra fija de 72px con tokens mono: RASTRO, las pestañas de las cinco vistas, la
persona y el tema. En Mi día, el % fuera del plan a 92px a la izquierda y la lámina sellada del
pendiente a la derecha; abajo, el resumen en 4 columnas sobre una grilla de 12 y la bitácora en filas
con hairlines.

FORM: lámina de anuario (challenger design-annual-s-plate-section, fuera de mi lista ordenada),
seed 797f2f8b. Movimiento distintivo: el sello de texto en anillo, que gira 25s lineal y se detiene
con reduced-motion.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
