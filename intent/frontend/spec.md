# Spec: dashboard de Rastro (desde intent/frontend/intent.md 2026-10-09)
Estado: aceptado

Origen: citas del intent del frontend. "README" es `frontend/README.md`, que el intent adopta.

## Requisitos
- REQ-1 MUST: build en `frontend/dist/` con `index.html` en la raíz; `rastro serve` lo sirve sin
  cambios en `backend/`. Origen: Restricciones, "El build estático queda en `frontend/dist/`".
- REQ-2 MUST: solo pide `/api/equipo` y `/api/persona/:id` al mismo origen. Nada de otros hosts
  (fuentes, scripts, imágenes). Origen: Restricciones, "Solo habla con `/api/*` del mismo origen".
- REQ-3 MUST: Equipo es el inicio. Una fila por persona con hechas/totales, pendientes, % fuera del
  plan, alerta y último update. Elegirla abre su vista. Origen: Preguntas abiertas, "La vista Equipo
  es la de `frontend/README.md`".
- REQ-4 MUST: Mi día muestra:
  - el resumen (Hice, Avancé, Sigue, Bloqueos);
  - la bitácora, lo más reciente arriba, con hora, tarea, rama, texto, evidencia y vínculo
    (`✓ nombre`, `~ inferido` con razón, `sin tarea`);
  - el costo.

  Origen: Resultado esperado, "La funcionalidad es la de `frontend/README.md`".
- REQ-5 MUST: Pendientes muestra tipo, tarea, texto, evidencia y próximo paso. "Resuelto sin cerrar"
  se destaca. Origen: Resultado esperado, "'Está resuelto en el código; nadie cerró el ticket' se
  destaca".
- REQ-6 MUST: Plan muestra:
  - el entregable;
  - las tareas con estado (las sacadas, tachadas);
  - la alerta con su %;
  - las tareas sin actividad;
  - el Gantt de dos barras por tarea. `plan: null` con `real` es una tarea fantasma.

  Origen: Resultado esperado, "Plan, con el Gantt".
- REQ-7 MUST: Sugerencias muestra patrón, fuente, ocurrencias, días y la propuesta con su porqué. El
  `contenido` va en un bloque copiable. Origen: Resultado esperado, "Sugerencias".
- REQ-8 MUST: estados. Origen: Resultado esperado, "los estados que hay que contemplar".
  - `resumen: null`: "Sin resumen".
  - `plan: null`: sin plan esta semana.
  - `gantt.mock`: etiqueta "mock" visible.
  - `alerta`: se ve en Equipo y en Plan.
  - Evidencia sin `url`: la `ref`, sin link.
  - Lista vacía: una frase.
  - Persona inexistente: un aviso y la vuelta a Equipo.
- REQ-9 MUST: lo que la persona no compartió no aparece ni se presenta como falta. Origen:
  Restricciones, "No es vigilancia".
- REQ-10 MUST: claro y oscuro. Respeta el sistema y se puede cambiar a mano. Origen: Restricciones,
  "Claro y oscuro, legible en proyector".
- REQ-11 SHOULD: textos en castellano rioplatense con voseo. Origen: Restricciones, "Textos en
  castellano rioplatense con voseo".
- REQ-12 SHOULD: cada vista de cada persona tiene su URL. Origen: Resultado esperado, "gana el
  desarrollador: ve su día".
- REQ-13 SHOULD: en desarrollo, corre contra `frontend/ejemplos/*` sin el central. Origen:
  Restricciones, "se diseña y se prueba contra `frontend/ejemplos/*`".
- REQ-14 MAY: una vista incompleta para la demo usa datos mock con la misma etiqueta que el Gantt.
  Origen: Restricciones, "Lo que quede a medio camino [...] puede quedar mock".
- REQ-15 MUST: si el central no responde, la UI dice "No pude hablar con el central" y ofrece
  reintentar. Origen: Cambios 2026-10-09, "si el central no responde".
- REQ-16 MUST: legible en proyector. El texto tiene contraste WCAG AA como mínimo en ambos temas y
  cuerpo grande. Origen: Restricciones, "legible en proyector"; Cambios 2026-10-09.

## Capacidades y escenarios
### Equipo (REQ-3, REQ-8)
- GIVEN `seed-demo` con Tomás en alerta WHEN abro `/` THEN veo 4 personas y la alerta de Tomás.
- GIVEN la fila de Lucía WHEN la elijo THEN se abre su Mi día.

### Mi día (REQ-4, REQ-8, REQ-12)
- GIVEN una entrada `inferido` WHEN miro la bitácora THEN veo `~ inferido` y su razón.
- GIVEN `resumen: null` WHEN abro Mi día THEN veo "Sin resumen" y la bitácora entera.
- GIVEN la URL de Mi día de Denis WHEN la abro directo THEN cae en esa vista.

### Pendientes (REQ-5, REQ-8)
- GIVEN un `resuelto-sin-cerrar` y un `todo-nuevo` WHEN abro Pendientes THEN el primero se distingue a
  simple vista.
- GIVEN una evidencia sin `url` WHEN la miro THEN veo la `ref` sin link.

### Plan y Gantt (REQ-6, REQ-8)
- GIVEN una barra con `plan: null` WHEN miro el Gantt THEN aparece como tarea fantasma, con la
  etiqueta "mock".
- GIVEN `plan: null` WHEN abro Plan THEN veo que no hay plan, no un error.

### Sugerencias (REQ-7, REQ-9)
- GIVEN una sugerencia WHEN uso copiar THEN el `contenido` exacto queda en el portapapeles.
- GIVEN `sugerencias: []` WHEN abro la vista THEN veo una frase neutra.

### Red y tema (REQ-1, REQ-2, REQ-10, REQ-13)
- GIVEN `rastro serve` sin red WHEN recorro las vistas THEN ningún request sale del origen.
- GIVEN `/api/persona/nadie` con `404` WHEN la abro THEN veo el aviso y el camino a Equipo.
- GIVEN el sistema en oscuro WHEN abro la UI THEN arranca oscura, y el cambio manual se mantiene.

### Central caído y proyector (REQ-15, REQ-16)
- GIVEN el central apagado WHEN abro la UI THEN veo "No pude hablar con el central" y reintentar.
- GIVEN cualquier vista y tema WHEN mido el contraste del texto THEN cumple WCAG AA.

## Concerns
- Seguridad: los textos vienen de commits y del LLM. Se muestran siempre como texto, nunca como HTML
  (XSS).
- Links de evidencia: van a GitHub; sin red no abren.
- Mock: la etiqueta tiene que verse de lejos. La entrega es hoy y REQ-14 es la válvula.
