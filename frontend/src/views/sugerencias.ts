import type { Snapshot, Sugerencia } from "../../../backend/src/contract/snapshot.ts";
import { h } from "../ui/dom.ts";
import { vacio } from "../ui/estado.ts";

const FUENTES: Record<Sugerencia["fuente"], string> = { zsh: "terminal", "claude-code": "Claude Code" };
const TIPOS: Record<Sugerencia["propuesta"]["tipo"], string> = { alias: "alias", script: "script", hook: "hook", skill: "skill" };

function copiar(contenido: string, aviso: HTMLElement): () => Promise<void> {
  return async () => {
    try {
      await navigator.clipboard.writeText(contenido);
      aviso.textContent = "Copiado";
    } catch (error) {
      // Se muestra al usuario, y la causa queda en consola para diagnosticar permisos o contexto no seguro.
      console.error("No se pudo copiar al portapapeles", error);
      aviso.textContent = "No pude copiar; seleccioná el texto";
    }
  };
}

function lamina(s: Sugerencia): HTMLElement {
  const aviso = h("span", { class: "etiqueta copiar-aviso", "aria-live": "polite" });
  return h(
    "article",
    { class: "lamina sugerencia" },
    h("p", { class: "dato sugerencia-patron" }, s.patron),
    h("p", { class: "dato meta" }, `${FUENTES[s.fuente]} · ${s.ocurrencias} ${s.ocurrencias === 1 ? "vez" : "veces"} en ${s.dias} ${s.dias === 1 ? "día" : "días"}`),
    h("p", { class: "etiqueta sugerencia-tipo" }, TIPOS[s.propuesta.tipo].toUpperCase()),
    h("p", { class: "sugerencia-porque" }, s.propuesta.porque),
    h("pre", { class: "sugerencia-codigo", tabindex: "0" }, h("code", {}, s.propuesta.contenido)),
    h("div", { class: "sugerencia-acciones" }, h("button", { type: "button", class: "boton", onclick: copiar(s.propuesta.contenido, aviso) }, "Copiar"), aviso),
  );
}

export function vistaSugerencias(snapshot: Snapshot): Node {
  if (snapshot.sugerencias.length === 0) return vacio("No hay sugerencias compartidas.");
  return h(
    "section",
    { class: "sugerencias", "aria-label": "Sugerencias" },
    h("h1", { class: "titulo" }, "Sugerencias"),
    h("div", { class: "laminas laminas-sugerencias" }, ...snapshot.sugerencias.map(lamina)),
  );
}
