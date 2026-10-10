import type { FilaEquipo } from "../../../backend/src/contract/equipo.ts";
import { h } from "../ui/dom.ts";
import { vistaVacia } from "../ui/estado.ts";
import { hashDe } from "../router.ts";

const ZONA = "America/Argentina/Buenos_Aires";
const DIA = new Intl.DateTimeFormat("es-AR", { timeZone: ZONA, year: "numeric", month: "numeric", day: "numeric" });
const DIA_CORTO = new Intl.DateTimeFormat("es-AR", { timeZone: ZONA, day: "numeric", month: "short" });
const HORA = new Intl.DateTimeFormat("es-AR", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "hoy 18:30" si es del día de `ahora`, y "8 oct 17:45" si no; siempre en hora de Buenos Aires. */
export function formatearUltimoUpdate(iso: string, ahora: Date = new Date()): string {
  const fecha = new Date(iso);
  // Un valor que no es fecha no debería llegar, pero ocultar el dato sería peor que mostrarlo crudo.
  if (Number.isNaN(fecha.getTime())) return iso;
  const hora = HORA.format(fecha);
  if (DIA.format(fecha) === DIA.format(ahora)) return `hoy ${hora}`;
  return `${DIA_CORTO.format(fecha).replace(".", "")} ${hora}`;
}

/** Con alerta primero y después por nombre: Rastro no rankea personas. */
function ordenar(filas: readonly FilaEquipo[]): FilaEquipo[] {
  return [...filas].sort(
    (a, b) => Number(b.alerta) - Number(a.alerta) || a.persona.nombre.localeCompare(b.persona.nombre, "es-AR"),
  );
}

function dato(etiqueta: string, valor: string): Node[] {
  return [h("dt", { class: "etiqueta meta" }, etiqueta), h("dd", { class: "dato" }, valor)];
}

function lamina(fila: FilaEquipo, ahora: Date): HTMLElement {
  const destino = hashDe({ tipo: "persona", id: fila.persona.id, vista: "mi-dia" });
  return h(
    "a",
    { class: fila.alerta ? "lamina persona-lamina placa-alerta" : "lamina persona-lamina", href: destino },
    h(
      "div",
      { class: "persona-cabecera" },
      h("h2", { class: "persona-nombre" }, fila.persona.nombre),
      ...(fila.alerta ? [h("span", { class: "desvio" }, "DESVÍO")] : []),
    ),
    h("p", { class: "persona-equipo meta" }, `${fila.persona.equipo} · ${fila.repo}`),
    h(
      "dl",
      { class: "persona-datos" },
      ...dato("Hechas", `${fila.tareasHechas} de ${fila.tareasTotales}`),
      ...dato("Pendientes", String(fila.pendientesAbiertos)),
      ...dato("Fuera del plan", `${fila.fueraDelPlanPct}%`),
      ...dato("Último update", formatearUltimoUpdate(fila.ultimoUpdate, ahora)),
    ),
  );
}

export function vistaEquipo(filas: FilaEquipo[], ahora: Date = new Date()): Node {
  if (filas.length === 0) {
    return vistaVacia("equipo", "Equipo", "Todavía nadie publicó su día. Cuando alguien corra ", h("code", {}, "rastro publish"), ", aparece acá.");
  }
  const conDesvio = filas.filter((f) => f.alerta).length;
  return h(
    "section",
    { class: "equipo", "aria-label": "Equipo" },
    h("h1", { class: "solo-lectores" }, "Equipo"),
    h(
      "div",
      { class: "protagonista" },
      h("p", { class: "display" }, String(conDesvio)),
      h(
        "div",
        { class: "protagonista-texto" },
        h("p", { class: "etiqueta" }, "CON DESVÍO"),
        h("p", { class: "cuerpo meta" }, `de ${filas.length} ${filas.length === 1 ? "persona" : "personas"}`),
      ),
    ),
    h("div", { class: "laminas" }, ...ordenar(filas).map((fila) => lamina(fila, ahora))),
  );
}
