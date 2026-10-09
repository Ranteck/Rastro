import type { Pendiente, Snapshot } from "../../../backend/src/contract/snapshot.ts";
import { h } from "../ui/dom.ts";
import { vacio } from "../ui/estado.ts";
import { listaEvidencia } from "../ui/evidencia.ts";
import { crearSello } from "../ui/sello.ts";
import { nombreDeTarea } from "../ui/tarea.ts";

const TIPOS: Record<Pendiente["tipo"], string> = {
  "resuelto-sin-cerrar": "Resuelto sin cerrar",
  "cerrado-sin-evidencia": "Cerrado sin evidencia",
  "rama-quieta": "Rama quieta",
  "todo-nuevo": "TODO nuevo",
  "codigo-sin-doc": "Código sin documentar",
};

function lamina(snapshot: Snapshot, p: Pendiente): HTMLElement {
  const principal = p.tipo === "resuelto-sin-cerrar";
  return h(
    "article",
    { class: principal ? "lamina pendiente pendiente-principal" : "lamina pendiente" },
    ...(principal ? [h("div", { class: "sello-posicion" }, crearSello())] : []),
    h("p", { class: "etiqueta pendiente-tipo" }, TIPOS[p.tipo]),
    h("p", { class: "dato meta" }, nombreDeTarea(snapshot, p.tarea)),
    h("p", { class: "cuerpo pendiente-texto" }, p.texto),
    ...listaEvidencia(p.evidencia),
    h(
      "div",
      { class: "proximo-paso" },
      h("p", { class: "etiqueta" }, "Próximo paso"),
      h("p", { class: "cuerpo" }, p.proximoPaso),
    ),
  );
}

/** Lo resuelto sin cerrar va primero; el resto conserva el orden del snapshot. */
function ordenar(pendientes: readonly Pendiente[]): Pendiente[] {
  const esProtagonista = (p: Pendiente): boolean => p.tipo === "resuelto-sin-cerrar";
  return [...pendientes.filter(esProtagonista), ...pendientes.filter((p) => !esProtagonista(p))];
}

export function vistaPendientes(snapshot: Snapshot): Node {
  if (snapshot.pendientes.length === 0) return vacio("No hay pendientes: todo lo resuelto está cerrado.");
  return h(
    "section",
    { class: "pendientes", "aria-label": "Pendientes" },
    h("h1", { class: "titulo" }, "Pendientes"),
    h("div", { class: "laminas laminas-pendientes" }, ...ordenar(snapshot.pendientes).map((p) => lamina(snapshot, p))),
  );
}
