import { h } from "./dom.ts";

export function copiar(contenido: string, aviso: HTMLElement): () => Promise<void> {
  return async () => {
    // Se vacía antes de intentar: un mismo texto repetido no se vuelve a anunciar en aria-live.
    aviso.textContent = "";
    try {
      await navigator.clipboard.writeText(contenido);
      aviso.textContent = "Copiado";
    } catch (error) {
      // Se muestra al usuario, y la causa queda en consola para diagnosticar permisos o contexto no seguro.
      console.warn("No se pudo copiar al portapapeles", error);
      aviso.textContent = "No pude copiar; seleccioná el texto";
    }
  };
}

/** Bloque de código enfocable con su botón "Copiar" y el aviso: sin portapapeles el texto queda seleccionable. */
export function bloqueCopiable(contenido: string): HTMLElement[] {
  const aviso = h("span", { class: "etiqueta copiar-aviso", "aria-live": "polite" });
  return [
    h("pre", { class: "bloque-codigo", tabindex: "0" }, h("code", {}, contenido)),
    h("div", { class: "bloque-acciones" }, h("button", { type: "button", class: "boton boton-primario", onclick: copiar(contenido, aviso) }, "Copiar"), aviso),
  ];
}
