import type { Vistas } from "../app.ts";
import { vistaEquipo } from "./equipo.ts";
import { vistaPendientes } from "./pendientes.ts";

/** T4 y T5 registran acá Mi día, Plan y Sugerencias. */
export const vistas: Vistas = { equipo: vistaEquipo, persona: { pendientes: vistaPendientes } };
