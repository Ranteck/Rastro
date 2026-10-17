import type { Evidencia } from "../../../backend/src/contract/snapshot.ts";
import { esUrlWeb, h } from "./dom.ts";

const ETIQUETA_EVIDENCIA: Record<Evidencia["tipo"], string> = {
  commit: "commit",
  rama: "rama",
  doc: "doc",
  sesion: "sesión",
};

function itemEvidencia(e: Evidencia): HTMLElement {
  // El contrato solo exige un string en `url`: lo que no es http(s) se muestra como texto, no como link.
  const ref =
    e.url !== undefined && esUrlWeb(e.url)
      ? h("a", { class: "dato", href: e.url, target: "_blank", rel: "noopener noreferrer" }, e.ref)
      : h("span", { class: "dato" }, e.ref);
  return h("li", { class: "evidencia-item" }, h("span", { class: "etiqueta meta" }, ETIQUETA_EVIDENCIA[e.tipo]), ref);
}

/** Sin evidencia no hay lista: un `ul` vacío se anuncia como lista vacía en los lectores de pantalla. */
export function listaEvidencia(evidencia: readonly Evidencia[]): HTMLElement[] {
  if (evidencia.length === 0) return [];
  return [h("ul", { class: "evidencia", "aria-label": "Evidencia" }, ...evidencia.map(itemEvidencia))];
}
