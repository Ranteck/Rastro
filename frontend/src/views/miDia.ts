import type { Desvios, EntradaBitacora, Resumen, Snapshot } from "../../../backend/src/contract/snapshot.ts";
import { hashDe } from "../router.ts";
import { h } from "../ui/dom.ts";
import { vacio } from "../ui/estado.ts";
import { listaEvidencia } from "../ui/evidencia.ts";
import { crearSelloChico } from "../ui/sello.ts";
import { nombreDeTarea } from "../ui/tarea.ts";

const FECHA = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
const NUMERO = new Intl.NumberFormat("es-AR");
const USD = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

const MARCAS: Record<EntradaBitacora["vinculo"], { clase: string; texto: string }> = {
  nombre: { clase: "marca-nombre", texto: "por nombre" },
  inferido: { clase: "marca-inferido", texto: "inferido" },
  "sin-tarea": { clase: "marca-sin-tarea", texto: "sin tarea" },
};

const COLUMNAS: ReadonlyArray<{ clave: keyof Resumen; titulo: string }> = [
  { clave: "hice", titulo: "Hice" },
  { clave: "avance", titulo: "Avancé" },
  { clave: "sigue", titulo: "Sigue" },
  { clave: "bloqueos", titulo: "Bloqueos" },
];

function formatearDia(iso: string): string {
  // Las fechas del contrato son YYYY-MM-DD sin zona: se leen en UTC para que no corran un día.
  return FECHA.format(new Date(`${iso}T00:00:00Z`));
}

function formatearPeriodo(desde: string, hasta: string): string {
  return desde === hasta ? formatearDia(desde) : `${formatearDia(desde)} – ${formatearDia(hasta)}`;
}

function formatearCosto(costo: Snapshot["costo"]): string {
  const llamadas = `${NUMERO.format(costo.llamadas)} ${costo.llamadas === 1 ? "llamada" : "llamadas"}`;
  return `${llamadas} · US$${USD.format(costo.usd)} · ${NUMERO.format(costo.tokens)} tokens`;
}

function fueraDelPlan(desvios: Desvios): HTMLElement {
  const clase = desvios.alerta ? "lamina fuera-del-plan placa-alerta" : "fuera-del-plan";
  return h(
    "div",
    { class: clase },
    h("p", { class: "display" }, `${desvios.fueraDelPlanPct}%`),
    h("p", { class: "etiqueta" }, "FUERA DEL PLAN"),
  );
}

function resueltosSinCerrar(snapshot: Snapshot): HTMLElement | null {
  const cantidad = snapshot.pendientes.filter((p) => p.tipo === "resuelto-sin-cerrar").length;
  if (cantidad === 0) return null;
  return h(
    "aside",
    { class: "lamina sello sin-cerrar" },
    crearSelloChico(),
    h(
      "div",
      {},
      h("p", { class: "sin-cerrar-cantidad" }, `${cantidad} ${cantidad === 1 ? "resuelto" : "resueltos"} sin cerrar`),
      h("a", { class: "boton", href: hashDe({ tipo: "persona", id: snapshot.persona.id, vista: "pendientes" }) }, "Ver pendientes"),
    ),
  );
}

function columna(titulo: string, items: readonly string[]): HTMLElement {
  return h(
    "section",
    { class: "resumen-columna" },
    h("h2", { class: "etiqueta resumen-titulo" }, titulo),
    items.length === 0
      ? h("p", { class: "meta" }, "—")
      : h("ul", { class: "resumen-lista" }, ...items.map((texto) => h("li", {}, texto))),
  );
}

function resumen(valor: Resumen | null): HTMLElement {
  if (valor === null) {
    return h("p", { class: "cuerpo meta resumen-ausente" }, "Sin resumen: el LLM no estuvo disponible en esta corrida.");
  }
  return h("div", { class: "resumen" }, ...COLUMNAS.map(({ clave, titulo }) => columna(titulo, valor[clave])));
}

function entrada(snapshot: Snapshot, e: EntradaBitacora): HTMLElement {
  const marca = MARCAS[e.vinculo];
  return h(
    "li",
    { class: "entrada" },
    h("span", { class: "dato entrada-hora" }, e.hora),
    h(
      "span",
      { class: "entrada-marca" },
      h("span", { class: `marca-vinculo ${marca.clase}`, "aria-hidden": "true" }),
      h("span", { class: "etiqueta meta" }, marca.texto),
    ),
    h(
      "div",
      { class: "entrada-cuerpo" },
      ...(e.tarea === null ? [] : [h("p", { class: "dato entrada-tarea" }, nombreDeTarea(snapshot, e.tarea))]),
      h("p", { class: "entrada-texto" }, e.texto),
      h("p", { class: "dato meta" }, e.rama),
    ),
    h(
      "div",
      { class: "entrada-margen" },
      listaEvidencia(e.evidencia),
      ...(e.razon === undefined ? [] : [h("p", { class: "razon" }, e.razon)]),
    ),
  );
}

/** Lo más reciente arriba: fecha y hora son strings de ancho fijo, así que se comparan como texto. */
function masRecientePrimero(bitacora: readonly EntradaBitacora[]): EntradaBitacora[] {
  return [...bitacora].sort((a, b) => `${b.fecha} ${b.hora}`.localeCompare(`${a.fecha} ${a.hora}`));
}

function bitacora(snapshot: Snapshot): HTMLElement {
  if (snapshot.bitacora.length === 0) return vacio("Hoy no hay actividad registrada.");
  return h("ol", { class: "bitacora" }, ...masRecientePrimero(snapshot.bitacora).map((e) => entrada(snapshot, e)));
}

export function vistaMiDia(snapshot: Snapshot): Node {
  const sello = resueltosSinCerrar(snapshot);
  return h(
    "section",
    { class: "mi-dia", "aria-label": "Mi día" },
    h(
      "header",
      { class: "cabecera-dia" },
      h("h1", { class: "titulo" }, snapshot.persona.nombre),
      h("p", { class: "cuerpo meta cabecera-fecha" }, formatearPeriodo(snapshot.periodo.desde, snapshot.periodo.hasta)),
      fueraDelPlan(snapshot.desvios),
      ...(sello === null ? [] : [sello]),
    ),
    resumen(snapshot.resumen),
    h("h2", { class: "etiqueta bitacora-titulo" }, "Bitácora"),
    bitacora(snapshot),
    h("p", { class: "dato meta costo" }, formatearCosto(snapshot.costo)),
  );
}
