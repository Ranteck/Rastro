import type { EntradaBitacora, Snapshot } from "../../../backend/src/contract/snapshot.ts";
import { h } from "../ui/dom.ts";
import type { Edicion } from "../ui/edicion.ts";

/** El SHA de la evidencia de tipo commit: sin ella la entrada no se puede corregir. */
export function commitDe(e: EntradaBitacora): string | null {
  return e.evidencia.find((ev) => ev.tipo === "commit")?.ref ?? null;
}

/** Botón "Corregir tarea" de una entrada y el selector que abre: a qué tarea del plan pertenece ese commit. */
export function corregirTarea(snapshot: Snapshot, e: EntradaBitacora, commit: string, edicion: Edicion): HTMLElement {
  const lugar = h("div", { class: "edicion-lugar" });
  const tareas = snapshot.plan?.tareas ?? [];
  const selector = h("select", {}, h("option", { value: "" }, "Fuera del plan"), ...tareas.map((t) => h("option", { value: t.slug }, t.nombre)));
  selector.value = tareas.some((t) => t.slug === e.tarea) ? (e.tarea ?? "") : "";
  const nombre = `Corregir tarea del commit ${commit.slice(0, 7)}`;
  // La clave de foco es la del botón "Corregir tarea": tras aplicar, el repintado reemplaza ambos y el foco vuelve a ese.
  const clave = `corregir:${commit}`;
  const aviso = h("p", { class: "edicion-error", role: "alert" });
  const verCambio = h("button", { type: "button", class: "boton", "data-foco": clave }, "Ver cambio");
  const alCambiar = (): void => {
    aviso.textContent = "";
    edicion.cancelar(lugar);
  };
  verCambio.addEventListener("click", () => {
    const tarea = selector.value === "" ? null : selector.value;
    if (tarea === e.tarea) {
      aviso.textContent = "No cambiaste nada.";
      return;
    }
    aviso.textContent = "";
    edicion.proponer([{ tipo: "vinculo", commit, tarea }], lugar, verCambio);
  });
  selector.addEventListener("change", alCambiar);
  const formulario = h(
    "div",
    { class: "edicion-form", role: "group", "aria-label": nombre, hidden: true },
    h("label", { class: "edicion-etiqueta" }, h("span", { class: "etiqueta meta" }, "Tarea del commit"), selector),
    aviso,
    verCambio,
    lugar,
  );
  const boton = h("button", { type: "button", class: "boton-discreto", "aria-expanded": "false", "aria-label": nombre, "data-foco": clave }, "Corregir tarea");
  boton.addEventListener("click", () => {
    formulario.hidden = !formulario.hidden;
    boton.setAttribute("aria-expanded", String(!formulario.hidden));
    if (formulario.hidden) alCambiar();
  });
  return h("div", { class: "entrada-correccion" }, boton, formulario);
}
