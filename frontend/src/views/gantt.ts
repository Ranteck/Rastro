import type { Snapshot } from "../../../backend/src/contract/snapshot.ts";
import { h } from "../ui/dom.ts";
import { etiquetaMock } from "../ui/estado.ts";
import { aMs, formatearDia } from "../ui/fecha.ts";
import { nombreDeTarea } from "../ui/tarea.ts";
import { formatearDias, tramosDeDias } from "../ui/tiempos.ts";

type Barra = Snapshot["gantt"]["barras"][number];
type Rango = NonNullable<Barra["plan"]>;

const DIA_MS = 86_400_000;
const DIAS_SEMANA_LABORAL = 5;
const DIA_CORTO = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short", day: "numeric" });
const DIA_COMPLETO = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const DIA_LARGO = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "numeric", month: "short" });

/** Un `hasta` absurdo pasa la validación del contrato; sin tope generaría millones de columnas. */
const MAX_DIAS = 31;

function columnas(snapshot: Snapshot): { dias: number[]; recortado: boolean } {
  const hoy = snapshot.periodo.hasta;
  // Un `hasta` ilegible no puede vaciar el Gantt: sin hoy se dibujan las barras igual y no hay línea.
  const rangoDeHoy: Rango[] = Number.isNaN(aMs(hoy)) ? [] : [{ desde: hoy, hasta: hoy }];
  const rangos = [...snapshot.gantt.barras.flatMap((b) => [b.plan, b.real]).filter((r): r is Rango => r !== null), ...rangoDeHoy];
  const inicioSemana = snapshot.plan === null ? null : aMs(snapshot.plan.semana);
  const desde = rangos.length > 0 ? Math.min(...rangos.map((r) => aMs(r.desde))) : inicioSemana;
  const hasta = rangos.length > 0 ? Math.max(...rangos.map((r) => aMs(r.hasta))) : inicioSemana === null ? null : inicioSemana + (DIAS_SEMANA_LABORAL - 1) * DIA_MS;
  if (desde === null || hasta === null) return { dias: [], recortado: false };
  const total = Math.round((hasta - desde) / DIA_MS) + 1;
  return { dias: Array.from({ length: Math.min(total, MAX_DIAS) }, (_, i) => desde + i * DIA_MS), recortado: total > MAX_DIAS };
}

function descripcion(rango: Rango): string {
  const dia = (iso: string): string => formatearDia(DIA_LARGO, iso);
  return rango.desde === rango.hasta ? dia(rango.desde) : `${dia(rango.desde)} al ${dia(rango.hasta)}`;
}

/** Columna (desde 1) del día de hoy, o null si queda fuera de lo dibujado. */
function columnaDe(iso: string, primero: number, dias: number): number | null {
  const columna = Math.round((aMs(iso) - primero) / DIA_MS) + 1;
  return Number.isNaN(columna) || columna < 1 || columna > dias ? null : columna;
}

/**
 * Las filas, apiladas, dibujan una sola línea: cada una la extiende por su padding y su borde.
 * Es un hijo absoluto de la grilla: con el fin en `auto` ocuparía hasta el borde derecho y la línea quedaría fuera de su columna.
 */
function lineaDeHoy(columna: number | null): HTMLElement[] {
  return columna === null ? [] : [h("span", { class: "gantt-hoy", style: `grid-column: ${columna} / ${columna + 1}`, "aria-hidden": "true" })];
}

/** La fecha va oculta a la vista: la línea y la etiqueta solas no le dicen a un lector cuál es hoy. */
function etiquetaDeHoy(snapshot: Snapshot, columna: number | null): HTMLElement[] {
  if (columna === null) return [];
  return [
    h(
      "span",
      { class: "etiqueta gantt-hoy-etiqueta", style: `grid-column: ${columna}` },
      h("span", { "aria-hidden": "true" }, "HOY"),
      h("span", { class: "solo-lectores" }, `Hoy: ${formatearDia(DIA_COMPLETO, snapshot.periodo.hasta)}`),
    ),
  ];
}

/** Al montarse, la región desplazable (mobile) queda con hoy a la vista; se mueve solo ella, nunca la página. */
function desplazarAHoy(region: HTMLElement, etiqueta: HTMLElement | null): void {
  if (etiqueta === null) return;
  const centrar = (): void => {
    if (!region.isConnected) return;
    const e = etiqueta.getBoundingClientRect();
    const r = region.getBoundingClientRect();
    region.scrollLeft += e.left + e.width / 2 - (r.left + r.width / 2);
  };
  requestAnimationFrame(centrar);
  // Al cargar las tipografías el ancho de las columnas cambia: se vuelve a centrar con las medidas finales.
  void document.fonts?.ready.then(centrar);
}

function barra(tipo: "plan" | "real", rango: Rango, primero: number, dias: number, fantasma: boolean, atrasada = false, texto = descripcion(rango)): HTMLElement[] {
  const inicio = Math.round((aMs(rango.desde) - primero) / DIA_MS) + 1;
  if (inicio > dias) return [];
  const fin = Math.min(Math.round((aMs(rango.hasta) - primero) / DIA_MS) + 2, dias + 1);
  return [h("span", {
    class: `gantt-barra gantt-barra-${tipo}${fantasma ? " gantt-barra-fantasma" : ""}${atrasada ? " gantt-barra-atrasada" : ""}`,
    style: `grid-column: ${inicio} / ${fin}`,
    role: "img",
    "aria-label": `${tipo === "plan" ? (atrasada ? "Plan, atrasada" : "Plan") : "Real"}: ${texto}`,
  })];
}

/** Un segmento por tramo de días consecutivos: una tarea en lun y jue no se dibuja como un bloque lun–jue. Sin días asignados queda el rango del Gantt. */
function barrasDelPlan(snapshot: Snapshot, b: Barra, rango: Rango, primero: number, dias: number): HTMLElement[] {
  const tareaDias = snapshot.plan?.tareas.find((t) => t.slug === b.tarea)?.dias ?? [];
  if (tareaDias.length === 0) return barra("plan", rango, primero, dias, false, b.atrasada);
  return tramosDeDias(tareaDias).flatMap((tramo) => {
    const desde = tramo[0] ?? rango.desde;
    const hasta = tramo[tramo.length - 1] ?? desde;
    return barra("plan", { desde, hasta }, primero, dias, false, b.atrasada, formatearDias(tramo));
  });
}

/** Una tarea del plan sin días no es un fantasma aunque tenga actividad: el fantasma es trabajo que el plan no nombra. */
function sinPlan(snapshot: Snapshot, b: Barra): string {
  const t = snapshot.plan?.tareas.find((x) => x.slug === b.tarea);
  if (t?.noEntra === true) return "no entra esta semana";
  return t?.duracion === null ? "sin estimar" : "sin días asignados";
}

function fila(snapshot: Snapshot, b: Barra, primero: number, dias: number, hoy: number | null): HTMLElement {
  const enPlan = snapshot.plan?.tareas.some((t) => t.slug === b.tarea) === true;
  const fantasma = b.plan === null && b.real !== null && !enPlan;
  return h(
    "div",
    { class: fantasma ? "gantt-fila gantt-fantasma" : "gantt-fila" },
    h(
      "div",
      { class: "gantt-tarea" },
      h("p", { class: "gantt-nombre" }, nombreDeTarea(snapshot, b.tarea)),
      ...(b.repo === undefined || enPlan ? [] : [h("p", { class: "dato meta gantt-repo" }, b.repo)]),
      ...(fantasma ? [h("p", { class: "etiqueta gantt-leyenda-fantasma" }, "FANTASMA · NO ESTABA EN EL PLAN")] : []),
      ...(b.atrasada ? [h("p", { class: "gantt-leyenda-fantasma" }, h("span", { class: "etiqueta marca-atrasada" }, "ATRASADA"))] : []),
      ...(b.plan === null && !fantasma ? [h("p", { class: "etiqueta meta" }, sinPlan(snapshot, b))] : []),
      ...(b.real === null ? [h("p", { class: "etiqueta meta" }, "sin actividad")] : []),
    ),
    h(
      "div",
      { class: "gantt-pista", style: `--dias: ${dias}` },
      ...lineaDeHoy(hoy),
      ...(b.plan === null ? [] : barrasDelPlan(snapshot, b, b.plan, primero, dias)),
      ...(b.real === null ? [] : barra("real", b.real, primero, dias, fantasma)),
    ),
  );
}

function leyenda(): HTMLElement {
  const item = (clase: string, texto: string): HTMLElement =>
    h("li", { class: "gantt-leyenda-item" }, h("span", { class: `gantt-muestra ${clase}`, "aria-hidden": "true" }), texto);
  return h(
    "ul",
    { class: "gantt-leyenda etiqueta" },
    item("gantt-barra-plan", "PLAN"),
    item("gantt-barra-real", "REAL"),
    item("gantt-barra-real gantt-barra-fantasma", "FUERA DEL PLAN"),
    item("gantt-barra-plan gantt-barra-atrasada", "ATRASADA"),
    item("gantt-muestra-hoy", "HOY"),
  );
}

export function gantt(snapshot: Snapshot): HTMLElement {
  const { dias, recortado } = columnas(snapshot);
  const primero = dias[0] ?? 0;
  const hoy = columnaDe(snapshot.periodo.hasta, primero, dias.length);
  const etiqueta = etiquetaDeHoy(snapshot, hoy);
  const region = h(
    "div",
    { class: "gantt-scroll", tabindex: "0", role: "region", "aria-label": "Plan contra real, desplazable" },
    h(
      "div",
      { class: "gantt-tabla", style: `--dias: ${dias.length}` },
      h(
        "div",
        { class: "gantt-fila gantt-cabecera" },
        h("div"),
        h(
          "div",
          { class: "gantt-pista", style: `--dias: ${dias.length}` },
          ...dias.map((d) => h("span", { class: "dato meta gantt-dia" }, DIA_CORTO.format(d))),
          ...etiqueta,
        ),
      ),
      ...snapshot.gantt.barras.map((b) => fila(snapshot, b, primero, dias.length, hoy)),
    ),
  );
  desplazarAHoy(region, etiqueta[0] ?? null);
  return h(
    "section",
    { class: "gantt", "aria-label": "Plan contra real" },
    h("div", { class: "gantt-titulo" }, h("h2", {}, "Plan contra real"), ...(snapshot.gantt.mock ? [etiquetaMock()] : [])),
    leyenda(),
    ...(recortado ? [h("p", { class: "etiqueta gantt-recorte", role: "status" }, `Rango recortado a ${MAX_DIAS} días`)] : []),
    region,
  );
}
