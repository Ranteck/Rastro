import type { Plan, Tarea } from "./contract/snapshot.ts";
import { ErrorUsuario } from "./errores.ts";
import { ddmm, desdeDdmm, lunesDe, type Fecha } from "./fechas.ts";
import { slugDe } from "./texto.ts";

const RE_ENCABEZADO = /^## Plan semana (\d{2}\/\d{2})\s*$/;
const RE_ENTREGABLE = /^- (~~)?\*\*Entregable del viernes:\*\*\s*(.*?)(~~)?\s*$/;
const RE_TAREA = /^- \[([ xX])\] (~~)?\*\*(.+?):\*\*\s*(.*?)(~~)?\s*$/;

/** Devuelve el plan de la semana de `hoy` o null si el archivo no tiene uno. */
export function parsearPlan(md: string, hoy: Fecha): Plan | null {
  const lineas = md.split(/\r?\n/);
  const lunes = lunesDe(hoy);
  const inicio = lineas.findIndex((l) => {
    const m = RE_ENCABEZADO.exec(l);
    return m !== null && m[1] !== undefined && desdeDdmm(m[1], hoy) === lunes;
  });
  if (inicio === -1) return null;

  let entregable = "";
  const tareas: Tarea[] = [];
  for (let i = inicio + 1; i < lineas.length; i++) {
    const linea = lineas[i] ?? "";
    if (/^#{1,6} /.test(linea)) break;
    // Vacías y sub-bullets con fecha: son comentarios del plan, no tareas.
    if (linea.trim() === "" || /^\s/.test(linea) || linea.startsWith("- **Cierre")) continue;
    const e = RE_ENTREGABLE.exec(linea);
    if (e !== null) {
      if (e[1] === undefined) entregable = e[2] ?? "";
      continue;
    }
    const t = RE_TAREA.exec(linea);
    if (t === null || t[3] === undefined) {
      throw new ErrorUsuario(`plan.md línea ${i + 1}: no es una tarea válida (se espera "- [ ] **Nombre:** objetivo")`);
    }
    tareas.push({
      slug: slugDe(t[3]),
      nombre: t[3],
      objetivo: t[4] ?? "",
      estado: t[2] === "~~" ? "sacada" : t[1] === " " ? "pendiente" : "hecha",
    });
  }
  return { semana: lunes, entregable, tareas };
}

export type TareaARenderizar = { nombre: string; objetivo: string; estado?: Tarea["estado"] };

export function renderizarPlan(semana: Fecha, entregable: string, tareas: readonly TareaARenderizar[]): string {
  const linea = (t: TareaARenderizar): string =>
    t.estado === "sacada"
      ? `- [ ] ~~**${t.nombre}:** ${t.objetivo}~~`
      : `- [${t.estado === "hecha" ? "x" : " "}] **${t.nombre}:** ${t.objetivo}`;
  return [`## Plan semana ${ddmm(semana)}`, `- **Entregable del viernes:** ${entregable}`, ...tareas.map(linea), ""].join("\n");
}
