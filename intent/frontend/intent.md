# Intención: dashboard de Rastro (frontend)
Autor: Denis Hugo Perafan · Estado: aceptado · Fecha: 2026-10-09

## Problema
El central ya recibe lo que publica cada Rastro y expone `GET /api/equipo` y `GET /api/persona/:id`,
pero no tiene UI. Como `frontend/dist/` no existe, `rastro serve` muestra un aviso. Hoy la bitácora,
los pendientes, los desvíos y las sugerencias solo se ven en JSON o en Notion. El líder sigue
preguntando "¿esto está?".

## Resultado esperado
- El central "sirve un dashboard con todo lo anterior (Gantt plan vs. real incluido)" (intent raíz).
- La funcionalidad es la de `frontend/README.md`: las vistas, los estados que hay que contemplar y la
  API, sin recortes. Las vistas son cinco:
  - Equipo (inicio);
  - Mi día;
  - Pendientes;
  - Plan, con el Gantt;
  - Sugerencias.
- "Está resuelto en el código; nadie cerró el ticket" se destaca: es el protagonista de la demo.
- Si las necesidades chocan, gana el desarrollador: ve su día y decide qué comparte.
- Se entiende de un vistazo en una demo de 5 minutos en proyector.

## Usuarios y sistemas afectados
Desarrollador (primero yo), líder de equipo y jurado del AI Day. El trabajo vive en `frontend/` y
consume el central (`rastro serve`) a través del contrato `schemaVersion: 1` de `intent/spec.md`.

## Restricciones
- Vite + TypeScript estricto, sin framework. El build estático queda en `frontend/dist/`, con
  `index.html` en la raíz.
- Solo habla con `/api/*` del mismo origen. No llama a servicios externos y la demo corre sin red.
- Claro y oscuro, legible en proyector: contraste WCAG AA como mínimo y cuerpo grande.
- Textos en castellano rioplatense con voseo. Rastro es marca propia.
- Los datos del Gantt y de todo lo demás son mock: se diseña y se prueba contra
  `frontend/ejemplos/*`, que cumplen el contrato. El Gantt viene con `mock: true` y se etiqueta
  ("mock" o "visión").
- Lo que quede a medio camino para la demo puede quedar mock, como el Gantt, y se etiqueta igual.
- Referencias visuales (Pinterest) en `frontend/referencias/`.
- No es vigilancia: lo que la persona no compartió no aparece.
- Entrega: AI Day, 2026-10-09.

## Fuera de alcance
Propuesto, a confirmar:
- cambiar el contrato o el motor (`backend/`);
- autenticación y despliegue fuera de la máquina local;
- vistas para cliente o dirección.

## Preguntas abiertas
Ninguna. La vista Equipo es la de `frontend/README.md`: una fila o tarjeta por persona con tareas
hechas sobre totales, pendientes abiertos, % fuera del plan, alerta de desvío y último update. Eso
cierra la pregunta abierta del intent raíz (Denis, 2026-10-09).

## Cambios
2026-10-09: Si el central no responde, la UI lo dice y deja reintentar; "legible en proyector" se
mide con contraste WCAG AA y cuerpo grande. Motivo: concerns del spec. OK de Denis.
