# Plan: dashboard de Rastro (desde spec.md 2026-10-09 e intent.md 2026-10-09)
Estado: aceptado

## Archivos que cambian
**Existentes (verificados):**
- `frontend/README.md`: suma cómo correr, cómo construir y el modo desarrollo.
- `backend/src/contract/{snapshot,equipo,validar}.ts`: se importan sin cambios. Son puros (sin
  `node:`) y garantizan que la UI valide con el mismo contrato que el central.

**Nuevos, en `frontend/`:**
- Base:
  - `package.json`, `tsconfig.json` (strict, como el backend), `vite.config.ts` (`base: "./"`,
    `outDir: "dist"`) e `index.html`.
- Código, en `src/`:
  - `main.ts`: arranque y tema.
  - `router.ts`: rutas hash, como `#/persona/denis/mi-dia`. Así hay deep links sin tocar el central.
  - `api.ts`: `fetch` a `/api/*`, valida con el contrato y devuelve un error tipado si el central no
    responde. En desarrollo usa `ejemplos/`.
  - `ui/dom.ts`: helper que arma nodos solo con `textContent`, nunca con `innerHTML`.
  - `ui/{sello,marca,estado,copiar}.ts`.
  - `views/{equipo,miDia,pendientes,plan,sugerencias}.ts` y `views/gantt.ts`.
  - `styles/{tokens,base}.css`.
- Tests:
  - `test/*.test.ts`: Vitest con jsdom, contra `frontend/ejemplos/*` y variantes armadas en el test.

**Dependencias nuevas (todas dev):**
- `vite`, `typescript`, `vitest` y `jsdom`.
- `@fontsource/schibsted-grotesk` y `@fontsource/jetbrains-mono`. Vite empaqueta las fuentes en
  `dist/`, así que quedan self-hosted y la UI no hace pedidos externos.

El build no suma dependencias de runtime.

**No cambia:** `backend/` y el contrato.

**Diseño:** dirección "Lámina de anuario".
- El contrato de dirección queda en el brief de superficie de impeccable antes de escribir código.
- `DESIGN.md` se escribe al final, a partir de lo construido.

## Tests a escribir
| Test (comportamiento observable) | REQ que cubre |
| --- | --- |
| El build deja `dist/index.html` con rutas relativas y `rastro serve` lo sirve | REQ-1 |
| El bundle no tiene URLs a otros hosts y `api` solo pide `/api/*` | REQ-2 |
| Equipo lista a las personas, marca la alerta y el clic lleva a `#/persona/<id>/mi-dia` | REQ-3 |
| Mi día: resumen en 4 bloques, bitácora de la más nueva a la más vieja, marca de vínculo con la razón del inferido y costo | REQ-4 |
| Pendientes: el resuelto-sin-cerrar va primero y lleva el sello | REQ-5 |
| Plan: sacadas tachadas, alerta con su %, tareas sin actividad y Gantt con tarea fantasma | REQ-6 |
| Sugerencias: copiar deja el `contenido` exacto en el portapapeles | REQ-7 |
| Estados: resumen nulo, plan nulo, etiqueta mock, evidencia sin `url`, lista vacía y 404 | REQ-8, REQ-14 |
| Sugerencias vacías muestran una frase neutra, sin texto de reproche | REQ-9 |
| El tema arranca como el sistema y el cambio manual persiste | REQ-10 |
| Un texto con `<img onerror>` en la bitácora se ve como texto | Concerns (XSS) |
| Si `fetch` falla aparece "No pude hablar con el central", y reintentar vuelve a pedir | REQ-15 |
| Los pares de tokens de texto y fondo cumplen WCAG AA (4.5:1) en los dos temas | REQ-16 |
| Una URL de vista abierta directo renderiza esa vista | REQ-12 |
| En modo desarrollo carga `ejemplos/` sin el central | REQ-13 |

REQ-11 (voseo) se revisa a mano en la revisión de cada vista.

## Orden de trabajo
1. Brief de superficie con el contrato de dirección (impeccable).
2. Scaffold de Vite, tokens claro y oscuro, fuentes, tema y test de contraste (REQ-1, 2, 10, 16).
3. `api`, router, `dom` y estados comunes: error del central, 404, vacío y mock
   (REQ-2, 8, 12, 13, 15, XSS).
4. Equipo (REQ-3).
5. Pendientes, con el sello (REQ-5).
6. Mi día (REQ-4).
7. Plan y Gantt (REQ-6).
8. Sugerencias (REQ-7, 9).
9. `npm run build`, después `rastro serve` con `seed-demo`, el detector de impeccable, capturas de
   desktop y mobile, finish reviewer y documenter (DESIGN.md).

El orden de las vistas sigue la demo. Si una no llega, se arma con datos mock y la etiqueta (REQ-14).

**Ejecución:** subagentes por tarea, con implementador, revisor de tarea y revisión final, en
`feat/frontend`. Se mergea solo cuando lo pidas.

## Riesgos
- **Tiempo:** la entrega es hoy. Las vistas 7 y 8 son las primeras candidatas a quedar mock.
- **Importar el contrato del backend:** si `tsconfig` o Vite no resuelven las extensiones `.ts`
  relativas, se ajusta la config del frontend, nunca el backend.
- **Bitácora real larga** (49 entradas): tiene que poder scrollear y la lista no puede romperse.
- **El sello girando:** se detiene con `prefers-reduced-motion` y no puede tapar texto.
- **Proyector:** las etiquetas mono del mundo (11px) son chicas, así que van a 13px como mínimo.

## Prueba
- `cd frontend && npm test`: corre todos los tests de la tabla.
- `npm run build` y, desde la raíz, `node backend/bin/rastro.js serve` con `seed-demo`: recorro las
  cinco vistas en Chrome (Browser 2), en claro y oscuro, y miro la pestaña de red para confirmar que
  no hay pedidos externos (REQ-1, 2, 3–10).
- Apago el central y recargo: tiene que aparecer el aviso y el botón de reintentar (REQ-15).
- `cd backend && npm run check` sigue en 146/146: el backend no se tocó.
- Detector de impeccable sin hallazgos materiales, finish reviewer con veredicto "ship" y DESIGN.md
  escrito.
