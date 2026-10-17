import type { Ofrecimiento, Snapshot } from "../../../backend/src/contract/snapshot.ts";
import { h } from "../ui/dom.ts";
import type { ContextoVista } from "../ui/edicion.ts";
import { formatearDuracion } from "../ui/tiempos.ts";

function ofrecimiento(o: Ofrecimiento, { edicion }: ContextoVista): HTMLElement {
  const lugar = h("div", { class: "edicion-lugar" });
  const accion = (texto: string, tipo: "aceptar" | "descartar", primario: boolean): HTMLButtonElement => {
    const boton = h("button", { type: "button", class: primario ? "boton boton-primario" : "boton", "aria-label": `${texto} ${o.nombre}` }, texto);
    boton.addEventListener("click", () => edicion?.proponer([{ tipo: "ofrecimiento", id: o.id, accion: tipo }], lugar, boton));
    return boton;
  };
  const aceptar = accion("Aceptar", "aceptar", true);
  // Con la vista previa abierta el único primario es su "Confirmar".
  new MutationObserver(() => aceptar.classList.toggle("boton-primario", lugar.childElementCount === 0)).observe(lugar, { childList: true });
  return h(
    "li",
    { class: "ofrecimiento" },
    h("p", { class: "ofrecimiento-nombre" }, o.nombre),
    h("p", { class: "meta" }, o.objetivo),
    h(
      "p",
      { class: "dato ofrecimiento-duracion" },
      formatearDuracion(o.duracion),
      ...(o.repo === undefined || o.repo === null ? [] : [" · ", h("span", { class: "meta" }, o.repo)]),
      " · ",
      h("span", { class: "etiqueta" }, `entra ${o.estadoSugerido === "hecha" ? "hecha" : "pendiente"}`),
    ),
    h("p", { class: "ofrecimiento-porque" }, o.porque),
    ...(edicion === null ? [] : [h("div", { class: "edicion-acciones" }, aceptar, accion("Descartar", "descartar", false))]),
    lugar,
  );
}

/** Lo que Rastro propone sumar al plan. Sin ofrecimientos la sección no existe. */
export function ofrecimientos(snapshot: Snapshot, contexto: ContextoVista): HTMLElement[] {
  if (snapshot.ofrecimientos.length === 0) return [];
  return [
    h(
      "section",
      { class: "ofrecimientos", "aria-labelledby": "ofrecimientos-titulo" },
      h("h2", { class: "etiqueta ofrecimientos-titulo", id: "ofrecimientos-titulo" }, "Ofrecimientos"),
      h("ul", { class: "ofrecimientos-lista" }, ...snapshot.ofrecimientos.map((o) => ofrecimiento(o, contexto))),
    ),
  ];
}
