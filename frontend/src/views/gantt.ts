import type { Snapshot } from "../../../backend/src/contract/snapshot.ts";
import { h } from "../ui/dom.ts";
import { etiquetaMock } from "../ui/estado.ts";
import { nombreDeTarea } from "../ui/tarea.ts";

type Barra = Snapshot["gantt"]["barras"][number];
type Rango = NonNullable<Barra["plan"]>;

const DIA_MS = 86_400_000;
const DIAS_SEMANA_LABORAL = 5;
const DIA_CORTO = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short", day: "numeric" });
const DIA_LARGO = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "numeric", month: "short" });

// Las fechas del contrato son YYYY-MM-DD sin zona: se leen en UTC para que no corran un día.
const aMs = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

function columnas(snapshot: Snapshot): number[] {
  const rangos = snapshot.gantt.barras.flatMap((b) => [b.plan, b.real]).filter((r): r is Rango => r !== null);
  const inicioSemana = snapshot.plan === null ? null : aMs(snapshot.plan.semana);
  const desde = rangos.length > 0 ? Math.min(...rangos.map((r) => aMs(r.desde))) : inicioSemana;
  const hasta = rangos.length > 0 ? Math.max(...rangos.map((r) => aMs(r.hasta))) : inicioSemana === null ? null : inicioSemana + (DIAS_SEMANA_LABORAL - 1) * DIA_MS;
  if (desde === null || hasta === null) return [];
  return Array.from({ length: Math.round((hasta - desde) / DIA_MS) + 1 }, (_, i) => desde + i * DIA_MS);
}

function descripcion(rango: Rango): string {
  return rango.desde === rango.hasta
    ? DIA_LARGO.format(aMs(rango.desde))
    : `${DIA_LARGO.format(aMs(rango.desde))} al ${DIA_LARGO.format(aMs(rango.hasta))}`;
}

function barra(tipo: "plan" | "real", rango: Rango, primero: number, fantasma: boolean): HTMLElement {
  const inicio = Math.round((aMs(rango.desde) - primero) / DIA_MS) + 1;
  const fin = Math.round((aMs(rango.hasta) - primero) / DIA_MS) + 2;
  return h("span", {
    class: fantasma ? `gantt-barra gantt-barra-${tipo} gantt-barra-fantasma` : `gantt-barra gantt-barra-${tipo}`,
    style: `grid-column: ${inicio} / ${fin}`,
    role: "img",
    "aria-label": `${tipo === "plan" ? "Plan" : "Real"}: ${descripcion(rango)}`,
  });
}

function fila(snapshot: Snapshot, b: Barra, primero: number, dias: number): HTMLElement {
  const fantasma = b.plan === null && b.real !== null;
  return h(
    "div",
    { class: fantasma ? "gantt-fila gantt-fantasma" : "gantt-fila" },
    h(
      "div",
      { class: "gantt-tarea" },
      h("p", { class: "dato gantt-nombre" }, nombreDeTarea(snapshot, b.tarea)),
      ...(fantasma ? [h("p", { class: "etiqueta gantt-leyenda-fantasma" }, "FANTASMA · NO ESTABA EN EL PLAN")] : []),
      ...(b.real === null ? [h("p", { class: "etiqueta meta" }, "sin actividad")] : []),
    ),
    h(
      "div",
      { class: "gantt-pista", style: `--dias: ${dias}` },
      ...(b.plan === null ? [] : [barra("plan", b.plan, primero, false)]),
      ...(b.real === null ? [] : [barra("real", b.real, primero, fantasma)]),
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
  );
}

export function gantt(snapshot: Snapshot): HTMLElement {
  const dias = columnas(snapshot);
  const primero = dias[0] ?? 0;
  return h(
    "section",
    { class: "gantt", "aria-label": "Plan contra real" },
    h("div", { class: "gantt-titulo" }, h("h2", { class: "etiqueta" }, "PLAN CONTRA REAL"), ...(snapshot.gantt.mock ? [etiquetaMock()] : [])),
    leyenda(),
    h(
      "div",
      { class: "gantt-tabla" },
      h(
        "div",
        { class: "gantt-fila gantt-cabecera" },
        h("div"),
        h(
          "div",
          { class: "gantt-pista", style: `--dias: ${dias.length}` },
          ...dias.map((d) => h("span", { class: "dato meta gantt-dia" }, DIA_CORTO.format(d))),
        ),
      ),
      ...snapshot.gantt.barras.map((b) => fila(snapshot, b, primero, dias.length)),
    ),
  );
}
