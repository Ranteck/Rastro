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

/** A dónde se vuelve cuando la ruta no existe: a Equipo, o a Mi día si la sesión es personal y no hay Equipo. */
export type Salida = { texto: string; hash: string };

export const SALIDA_EQUIPO: Salida = { texto: "Equipo", hash: "#/equipo" };

export function personaInexistente(mensaje: string, salida: Salida = SALIDA_EQUIPO): HTMLElement {
  return h(
    "section",
    { class: "estado lamina" },
    h("p", { class: "cuerpo" }, mensaje),
    h("a", { class: "boton", href: salida.hash }, `Volver a ${salida.texto}`),
  );
}

export function paginaNoEncontrada(salida: Salida = SALIDA_EQUIPO): HTMLElement {
  return h(
    "section",
    { class: "estado lamina" },
    h("p", { class: "cuerpo" }, "No encontré esa página"),
    h("a", { class: "boton", href: salida.hash }, `Ir a ${salida.texto}`),
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
