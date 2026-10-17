import type { Snapshot, Sugerencia } from "../../../backend/src/contract/snapshot.ts";
import { bloqueCopiable } from "../ui/copiar.ts";
import { h } from "../ui/dom.ts";
import { vistaVacia } from "../ui/estado.ts";

const FUENTES: Record<Sugerencia["fuente"], string> = { zsh: "terminal", "claude-code": "Claude Code" };

function lamina(s: Sugerencia): HTMLElement {
  return h(
    "article",
    { class: "lamina sugerencia" },
    h("p", { class: "dato sugerencia-patron" }, s.patron),
    h("p", { class: "meta" }, `${FUENTES[s.fuente]} · ${s.ocurrencias} ${s.ocurrencias === 1 ? "vez" : "veces"} en ${s.dias} ${s.dias === 1 ? "día" : "días"}`),
    h("p", { class: "etiqueta sugerencia-tipo" }, s.propuesta.tipo.toUpperCase()),
    h("p", { class: "sugerencia-porque" }, s.propuesta.porque),
    ...bloqueCopiable(s.propuesta.contenido),
  );
}

export function vistaSugerencias(snapshot: Snapshot): Node {
  if (snapshot.sugerencias.length === 0) return vistaVacia("sugerencias", "Sugerencias", "No hay sugerencias compartidas.");
  return h(
    "section",
    { class: "sugerencias", "aria-label": "Sugerencias" },
    h("h1", { class: "titulo" }, "Sugerencias"),
    h("div", { class: "laminas laminas-sugerencias" }, ...snapshot.sugerencias.map(lamina)),
  );
}
