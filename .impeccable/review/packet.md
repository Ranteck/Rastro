# Paquete para el finish review del dashboard de Rastro

- **Pedido original:** el dashboard del central de Rastro (Flock AI Day 2026). Son cinco vistas:
  Equipo, Mi día, Pendientes, Plan con Gantt plan vs. real (mock) y Sugerencias. Va en claro y oscuro
  y tiene que leerse en proyector.
- **Respuestas confirmadas por Denis:**
  - stack: Vite + TS sin framework;
  - usuario prioritario: el desarrollador;
  - marca propia;
  - la UI se implementa;
  - todo con datos mock de `frontend/ejemplos/*`;
  - lo que no llegue queda mock y etiquetado;
  - central caído: aviso y reintentar;
  - proyector: WCAG AA y cuerpo grande.
- **Dirección elegida:** "Lámina de anuario", challenger `design-annual-s-plate-section`, seed
  797f2f8b. Build code-led, sin generación de imágenes.
- **Contrato de dirección:** `.impeccable/surfaces/frontend-index-html.md`.
- **Producto:** `PRODUCT.md`. Spec: `intent/frontend/spec.md`.
- **Artefacto:** `frontend/`. Entrada `frontend/index.html`; código en `frontend/src/`.
- **Capturas, todas obligatorias, en `.impeccable/review/`:**
  - `desktop.png`: Mi día, 1440, claro;
  - `desktop-oscuro.png`: Mi día, 1440, oscuro;
  - `mobile.png`: Mi día, 390;
  - `equipo.png`, `pendientes.png`, `plan.png`, `sugerencias.png`: 1440, claro;
  - `mobile-pendientes.png`: 390.
- **Detector:** `impeccable detect` sobre `frontend/src` y `frontend/index.html` dio 0 hallazgos
  (`.impeccable/review/detector.json`).
- **QUALITY BAR del mundo elegido:**
  - board: https://impeccable.style/worlds/cards/design-annual-s-plate-section.webp (copia local:
    `/home/denis-legion/.claude/jobs/ec197fb0/tmp/annual-board.png`);
  - hero: https://impeccable.style/worlds/cards/design-annual-s-plate-section-hero.webp (copia local:
    `/home/denis-legion/.claude/jobs/ec197fb0/tmp/annual-hero.png`).
- **Comp aprobado:** no hay, porque el build es code-led. Como referencia de crítica va el boceto
  HTML de la carta elegida: `.impeccable/mocks/decision/challenger-annual.html`.
- **Piso de craft:** `/home/denis-legion/.claude/plugins/cache/impeccable/impeccable/4.5.2/skills/impeccable/reference/craft-floor.md`.
- **Plataforma:** web. Hay un dev server en el puerto 5299 sirviendo modo ejemplos, por si hace falta
  recapturar.
