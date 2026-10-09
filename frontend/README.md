# Pedido de UI: dashboard de Rastro

Estado: borrador · Fecha: 2026-10-09 · Contrato: `intent/spec.md`, sección "Contrato" (`schemaVersion: 1`)

## Cómo correrlo

```sh
npm install           # dependencias
npm run dev           # dev server; reenvía /api al central en 127.0.0.1:4317 (rastro serve)
npm run dev:ejemplos  # dev server sin central, con los JSON de ejemplos/
npm run check         # typecheck + tests + build
npm run build         # deja dist/, que `rastro serve` sirve tal cual
```

## Qué es

Rastro arma la memoria del equipo sola: cruza lo que pasó en el código con el plan y muestra qué está
resuelto, qué está pendiente y con qué evidencia. El dashboard es la cara del central: la persona ve
su día y el líder ve al equipo sin preguntarle a nadie.

Frase gancho: *"Está resuelto en el código; nadie cerró el ticket."*

## Quién lo usa

| Usuario | Pregunta que trae |
| --- | --- |
| Líder de equipo | ¿Qué está resuelto? ¿Quién se está desviando del plan? |
| Desarrollador | ¿Qué hice hoy, qué me quedó y qué podría automatizar? |
| Jurado del AI Day | Lo ve en una demo de 5 minutos: tiene que entenderse de un vistazo. |

## Vistas

1. **Equipo** (inicio). Una fila o tarjeta por persona: tareas hechas sobre totales, pendientes
   abiertos, % fuera del plan, alerta de desvío y último update. Al hacer clic se abre su vista.
   Datos: `GET /api/equipo`.
2. **Mi día.** El resumen en cuatro bloques (Hice, Avancé, Sigue, Bloqueos) y la bitácora, lo más
   reciente arriba. Cada entrada muestra hora, tarea, rama, texto, links de evidencia y el vínculo:
   `✓ nombre`, `~ inferido` (con su razón) o `sin tarea`. Muestra el costo de la corrida.
   Datos: `GET /api/persona/:id` → `resumen`, `bitacora`, `costo`.
3. **Pendientes.** Una tarjeta por pendiente: tipo, tarea, texto, evidencia y próximo paso.
   "Resuelto sin cerrar" es el protagonista de la demo y tiene que destacarse.
   Datos: `pendientes`.
4. **Plan.** Entregable de la semana, tareas con su estado (las sacadas, tachadas), alerta de desvío
   con su % y tareas sin actividad. Abajo, el Gantt plan vs. real: dos barras por tarea; una barra
   con `plan: null` y `real` es una "tarea fantasma" (trabajo que no estaba en el plan). Datos: `plan`, `desvios`, `gantt`.
5. **Sugerencias.** Patrón detectado, fuente (terminal o Claude Code), ocurrencias y días, y la
   automatización propuesta con su porqué. El `contenido` es código: necesita bloque copiable.
   Por defecto no se comparten: en el central la lista suele venir vacía salvo que la persona las
   haya habilitado. Datos: `sugerencias`.

## Estados que la UI tiene que contemplar

- `resumen: null`: el LLM no estuvo disponible. Mostrar "Sin resumen" y el resto normal.
- `plan: null`: la persona no tiene plan esta semana.
- `gantt.mock: true`: siempre en esta versión. Mostrar una etiqueta visible "mock" o "visión".
- `desvios.alerta: true`: tiene que verse en la vista Equipo y en Plan.
- `evidencia[].url` ausente: mostrar la `ref` (por ejemplo, el SHA corto) sin link.
- Listas vacías: estado vacío con una frase, no una tabla en blanco.
- Persona inexistente: `404`.

## API

Todo sale del central (`rastro serve`, mismo origen que la UI):

| Método y ruta | Respuesta | Ejemplo |
| --- | --- | --- |
| `GET /api/equipo` | `{ equipo: [...] }` | `ejemplos/equipo.json` |
| `GET /api/persona/:id` | `Snapshot` o `404` | `ejemplos/persona-denis.json` |

Los ejemplos cumplen el contrato y los valida el test del motor: se pueden usar como datos mock
mientras se diseña.

## Entrega

- Build estático en `frontend/dist/` con `index.html` en la raíz. `rastro serve` lo sirve tal cual.
- Stack libre, siempre que el resultado sea estático y solo hable con `/api/*` del mismo origen.
- Sin llamadas a servicios externos: la demo puede correr sin red.
- Claro y oscuro; tiene que leerse bien en un proyector.
