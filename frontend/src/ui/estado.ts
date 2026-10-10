import { h, type Hijo } from "./dom.ts";

export function cargando(): HTMLElement {
  return h("p", { class: "estado etiqueta meta", role: "status" }, "Cargando…");
}

export function errorCentral(mensaje: string, alReintentar: () => void): HTMLElement {
  return h(
    "section",
    { class: "estado lamina", role: "alert" },
    h("p", { class: "cuerpo" }, mensaje),
    h("button", { type: "button", class: "boton", onclick: alReintentar }, "Reintentar"),
  );
}

export function personaInexistente(mensaje: string): HTMLElement {
  return h(
    "section",
    { class: "estado lamina" },
    h("p", { class: "cuerpo" }, mensaje),
    h("a", { class: "boton", href: "#/equipo" }, "Volver a Equipo"),
  );
}

export function paginaNoEncontrada(): HTMLElement {
  return h(
    "section",
    { class: "estado lamina" },
    h("p", { class: "cuerpo" }, "No encontré esa página"),
    h("a", { class: "boton", href: "#/equipo" }, "Ir a Equipo"),
  );
}

export function vacio(...frase: Hijo[]): HTMLElement {
  return h("p", { class: "estado cuerpo meta" }, ...frase);
}

/** Una vista sin datos conserva su `section` y su título: así se ubica igual que con datos. */
export function vistaVacia(clase: string, titulo: string, ...frase: Hijo[]): HTMLElement {
  return h("section", { class: clase, "aria-label": titulo }, h("h1", { class: "titulo" }, titulo), vacio(...frase));
}

export function etiquetaMock(texto = "MOCK · VISIÓN"): HTMLElement {
  return h("span", { class: "etiqueta etiqueta-mock" }, texto);
}
