import type { Vistas } from "../app.ts";
import { vistaEquipo } from "./equipo.ts";
import { vistaMiDia } from "./miDia.ts";
import { vistaPendientes } from "./pendientes.ts";
import { vistaPlan } from "./plan.ts";
import { vistaSugerencias } from "./sugerencias.ts";

export const vistas: Vistas = {
  equipo: vistaEquipo,
  persona: { "mi-dia": vistaMiDia, pendientes: vistaPendientes, plan: vistaPlan, sugerencias: vistaSugerencias },
};
