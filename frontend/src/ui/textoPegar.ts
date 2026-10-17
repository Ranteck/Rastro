import type { Snapshot } from "../../../backend/src/contract/snapshot.ts";
import { textoParaPegar } from "../../../backend/src/contract/textos.ts";
import { bloqueCopiable } from "./copiar.ts";
import { h } from "./dom.ts";

/** Desplegable con lo que la persona hizo en la tarea, listo para pegar en Jira o Notion. Es solo lectura: no depende de la sesión. */
export function textoParaPegarDe(snapshot: Snapshot, slug: string): HTMLElement | null {
  const texto = textoParaPegar(snapshot, slug);
  if (texto === null) return null;
  return h("details", { class: "texto-pegar" }, h("summary", { class: "boton-discreto" }, "Texto para pegar"), ...bloqueCopiable(texto));
}
