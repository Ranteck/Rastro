import type { Snapshot, Tarea } from "../../../backend/src/contract/snapshot.ts";
import { decile, enLaTerminal, FRASES_CLAUDE } from "../ui/claude.ts";
import { h } from "../ui/dom.ts";
import { SOLO_LECTURA, type ContextoVista } from "../ui/edicion.ts";
import { vacio, vistaVacia } from "../ui/estado.ts";
import { formatearDia } from "../ui/fecha.ts";
import { placaFueraDelPlan } from "../ui/placa.ts";
import { nombreDeTarea } from "../ui/tarea.ts";
import { textoParaPegarDe } from "../ui/textoPegar.ts";
import { formatearDias, formatearDuracion } from "../ui/tiempos.ts";
import { editorDeTarea } from "./editorTarea.ts";
import { gantt } from "./gantt.ts";
import { ofrecimientos } from "./ofrecimientos.ts";

const SEMANA = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });

const MARCAS: Record<Tarea["estado"], { clase: string; texto: string }> = {
  hecha: { clase: "marca-lleno", texto: "hecha" },
  pendiente: { clase: "marca-hueco", texto: "pendiente" },
  sacada: { clase: "marca-raya", texto: "sacada" },
};

function desvio(snapshot: Snapshot): HTMLElement {
  const { tareasSinActividad } = snapshot.desvios;
  return h(
    "div",
    { class: "plan-desvio" },
    placaFueraDelPlan(snapshot.desvios),
    ...(tareasSinActividad.length === 0
      ? []
      : [h("p", { class: "cuerpo" }, `Sin actividad: ${tareasSinActividad.map((t) => nombreDeTarea(snapshot, t)).join(", ")}`)]),
  );
}

function tiempos(t: Tarea): HTMLElement {
  return h(
    "p",
    { class: "dato plan-tarea-tiempos" },
    h("span", { class: t.duracion === null ? "meta" : "" }, formatearDuracion(t.duracion)),
    ...(t.dias.length === 0 ? [] : [" ", h("span", {}, formatearDias(t.dias))]),
  );
}

function tarea(snapshot: Snapshot, t: Tarea, atrasada: boolean, { edicion, repos }: ContextoVista): HTMLElement {
  const { clase, texto } = MARCAS[t.estado];
  const editor = edicion === null ? null : editorDeTarea(snapshot, t, edicion, repos);
  const textoPegar = textoParaPegarDe(snapshot, t.slug);
  const aparte = [...(textoPegar === null ? [] : [textoPegar]), ...(editor === null ? [] : [editor.formulario])];
  return h(
    "li",
    { class: "plan-tarea" },
    h("span", { class: `marca-estado ${clase}`, "aria-hidden": "true" }),
    h(
      "div",
      { class: "plan-tarea-cuerpo" },
      h(
        "p",
        { class: "plan-tarea-nombre" },
        t.estado === "sacada" ? h("s", {}, t.nombre) : t.nombre,
        ...(atrasada ? [" ", h("span", { class: "etiqueta marca-atrasada" }, "ATRASADA")] : []),
      ),
      h("p", { class: "meta" }, t.objetivo),
      ...(t.estado === "sacada" ? [] : [tiempos(t)]),
      ...(t.repo === null ? [] : [h("p", { class: "dato meta plan-tarea-repo" }, t.repo)]),
      ...(t.noEntra ? [h("p", { class: "etiqueta plan-no-entra" }, "No entra esta semana")] : []),
    ),
    h(
      "div",
      { class: "plan-tarea-estado" },
      h("span", { class: "etiqueta meta" }, texto),
      ...(editor === null ? [] : [editor.boton]),
    ),
    ...(aparte.length === 0 ? [] : [h("div", { class: "plan-tarea-aparte" }, ...aparte)]),
  );
}

export function vistaPlan(snapshot: Snapshot, contexto: ContextoVista = SOLO_LECTURA): Node {
  if (snapshot.plan === null) {
    const { queViene } = contexto;
    // Con el plan de la semana que viene ya armado no se ofrece armar otro: se dice que está.
    if (queViene !== undefined) {
      const tareas = `${String(queViene.tareas)} ${queViene.tareas === 1 ? "tarea" : "tareas"}`;
      return vistaVacia("plan", "Plan", `No hay plan esta semana, pero ya está el de la semana del ${formatearDia(SEMANA, queViene.semana)} (${tareas}): arranca el lunes.`);
    }
    const vista = vistaVacia("plan", "Plan", "No hay plan esta semana. ", ...decile(FRASES_CLAUDE.sugerirPlan), ".");
    vista.append(...enLaTerminal("rastro plan --desde-proyecto"));
    return vista;
  }
  const atrasadas = new Set(snapshot.desvios.tareasAtrasadas);
  // Antes del primer daily no hay bitácora ni actividad que medir: los desvíos, las ofertas y el Gantt dirían "sin actividad" por pura ausencia.
  const sinDaily = contexto.sinDaily !== undefined;
  return h(
    "section",
    { class: "plan", "aria-label": "Plan" },
    h(
      "header",
      { class: "plan-cabecera" },
      h("h1", { class: "titulo" }, snapshot.plan.entregable),
      h("p", { class: "cuerpo meta" }, `Semana del ${formatearDia(SEMANA, snapshot.plan.semana)}`),
    ),
    ...(sinDaily ? [] : [desvio(snapshot)]),
    h("ul", { class: "plan-tareas" }, ...snapshot.plan.tareas.map((t) => tarea(snapshot, t, atrasadas.has(t.slug), contexto))),
    ...(sinDaily ? [vacio("La bitácora y el Gantt real aparecen después del primer daily. ", ...decile(FRASES_CLAUDE.cerrarElDia), "."), ...enLaTerminal("rastro daily")] : [...ofrecimientos(snapshot, contexto), gantt(snapshot)]),
  );
}
