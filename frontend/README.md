# Pedido de UI: dashboard de Rastro

Estado: borrador · Fecha: 2026-10-09 · Contrato: `intent/spec.md`, sección "Contrato" (`schemaVersion: 1`)

## Cómo correrlo

Requiere Node ≥ 22.18.

```sh
npm ci                # dependencias
npm run dev           # dev server; reenvía /api al central en 127.0.0.1:4317 (rastro serve)
npm run dev:ejemplos  # dev server sin central, con los JSON de ejemplos/ (solo en dev; en la barra lleva la etiqueta MODO EJEMPLOS: son datos de demostración)
npm run check         # typecheck + tests + build
npm run build         # deja dist/, que `rastro serve` sirve tal cual
```

Para la demo completa, desde `frontend/` y con `dist/` ya construido (sin `npm ci && npm run build`,
`rastro serve` responde que la UI todavía no está construida):

```sh
node ../backend/bin/rastro.js serve              # el central, con la UI en http://127.0.0.1:4317
node ../backend/bin/rastro.js seed-demo          # en otra terminal: carga personas de demostración
```

## Edición directa

Con el dashboard servido por el central en modo personal (`rastro serve --personal` o `rastro start`, con `dist/` construido) la persona puede editar su plan global desde la vista:

- **Plan:** "Editar" en cada tarea abre duración (o "sin estimar"), los siete días de la semana y el estado. "Aceptar" y "Descartar" resuelven un ofrecimiento.
- **Mi día:** "Corregir tarea" en una entrada con commit la vincula a otra tarea del plan o a "Fuera del plan".
- Todo cambio pasa por el mismo camino: "Ver cambio" muestra en línea la vista previa que calcula el central, y solo "Confirmar" lo aplica (Escape o "Cancelar" lo descartan sin mandar nada). Las reglas del plan son del central: la UI solo arma el cambio.
- Sin sesión personal (modo equipo, otra persona, `dev:ejemplos`, central caído) las vistas son de solo lectura. El dev server de Vite tampoco edita: el central rechaza los POST de otro origen. El token de la sesión vive solo en memoria.
- "Texto para pegar" (Plan) es de solo lectura y se ve siempre.

## Chat

En el mismo modo personal aparece la pestaña "Chat" (`#/persona/<id>/chat`), solo para la persona. Para el resto la ruta es la página "no encontrada".

- Habla con `POST /api/chat`. La respuesta se muestra como texto plano (el markdown no se convierte) y puede tardar hasta 180 s: mientras tanto la entrada queda deshabilitada y no hay cancelación.
- El chat nunca aplica cambios: si propone alguno, lo muestra con su vista previa y "Aplicar" (o "Descartar"). Solo "Aplicar" manda esos mismos cambios a `/api/cambios` con confirmación.
- Muestra el comando `claude --resume <id>` para retomar la sesión en la terminal. Cada mensaje usa tu cuenta de Claude; no escribas en la misma sesión desde la terminal mientras esperás una respuesta.
- La conversación vive en memoria mientras la página esté abierta: cambiar de pestaña no la pierde, recargar la vacía (Claude sigue recordando la sesión). No se guarda en el almacenamiento del navegador.

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
2. **Mi día.** Arriba, el foco: "Ahora", "Sigue" (con su duración y días) y "Atrasadas"; si no hay
   foco ni atrasadas, no muestra el bloque. Sigue el resumen en cuatro bloques (Hice, Avancé, Sigue,
   Bloqueos) y la bitácora, lo más reciente arriba. Cada entrada muestra hora, tarea, rama, texto,
   links de evidencia y el vínculo, que se distingue por forma: cuadrado lleno `nombre`, marco
   `inferido` (con su razón), raya `sin tarea` y rombo `corregido` (a mano). Muestra el costo de la corrida.
   Datos: `GET /api/persona/:id` → `foco`, `desvios`, `resumen`, `bitacora`, `costo`.
3. **Pendientes.** Una tarjeta por pendiente: tipo, tarea, texto, evidencia y próximo paso.
   "Resuelto sin cerrar" es el protagonista de la demo y tiene que destacarse.
   Datos: `pendientes`.
4. **Plan.** Entregable de la semana y tareas con su estado (las sacadas, tachadas), su duración
   ("2 d", "4 h" o "sin estimar") y sus días sugeridos ("lun–mié"). Una tarea que no entra dice "No entra
   esta semana" y una atrasada lleva la marca "ATRASADA". La placa de alerta suma, debajo del número, "N tareas atrasadas" (el snapshot no trae los umbrales,
   así que no afirma qué disparó la alerta) y se listan las tareas sin actividad. Abajo, el Gantt plan vs.
   real: la barra de plan sale de los días de la tarea (sin días no hay barra y se dice por qué), la
   atrasada va rayada y con su texto, y una línea marca "hoy", que es el día del snapshot (`periodo.hasta`)
   y no el reloj del navegador. Una barra con `plan: null` y `real` de una tarea que no está en el plan
   es una "tarea fantasma". Datos: `plan`, `desvios`, `gantt`.
5. **Sugerencias.** Patrón detectado, fuente (terminal o Claude Code), ocurrencias y días, y la
   automatización propuesta con su porqué. El `contenido` es código: necesita bloque copiable.
   Por defecto no se comparten: en el central la lista suele venir vacía salvo que la persona las
   haya habilitado. Datos: `sugerencias`.

## Estados que la UI tiene que contemplar

- `resumen: null`: el LLM no estuvo disponible. Mostrar "Sin resumen" y el resto normal.
- `plan: null`: la persona no tiene plan esta semana.
- `gantt.mock: true`: mostrar la etiqueta visible "MOCK · VISIÓN"; con `false` no aparece.
- `foco` con `null` o con slugs que ya no están en el plan: no muestra nada o nombra el slug, sin romper.
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
