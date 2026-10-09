import type { Vistas } from "../app.ts";
import { vistaEquipo } from "./equipo.ts";
import { vistaMiDia } from "./miDia.ts";
import { vistaPendientes } from "./pendientes.ts";

/** T5 registra acá Plan y Sugerencias. */
export const vistas: Vistas = { equipo: vistaEquipo, persona: { "mi-dia": vistaMiDia, pendientes: vistaPendientes } };
