export type Hijo = Node | string;
export type Valor = string | number | boolean | null | undefined | EventListener;
export type Atributos = Record<string, Valor>;

const NS_SVG = "http://www.w3.org/2000/svg";
const ESQUEMAS_WEB = new Set(["http:", "https:"]);
const ATRIBUTOS_URL = new Set(["href", "src", "action", "formaction", "xlink:href"]);

/** Lista permitida: el parser de URLs ignora tabs, saltos y controles iniciales, así que se resuelve igual que el navegador. */
export function esUrlWeb(valor: string): boolean {
  try {
    return ESQUEMAS_WEB.has(new URL(valor, window.location.href).protocol);
  } catch {
    // Lo que no se puede parsear no es una URL web: se rechaza.
    return false;
  }
}

function aplicar(el: Element, atributos: Atributos): void {
  for (const [nombre, valor] of Object.entries(atributos)) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (typeof valor === "function") {
      if (!nombre.startsWith("on")) throw new Error(`Solo los atributos on* admiten funciones: ${nombre}`);
      el.addEventListener(nombre.slice(2), valor);
      continue;
    }
    // Un string en onclick="..." se ejecuta como código: el texto de commits y del LLM no puede llegar ahí.
    if (nombre.startsWith("on")) throw new Error(`Atributo ${nombre} con texto: usá una función`);
    const texto = valor === true ? "" : String(valor);
    if (ATRIBUTOS_URL.has(nombre) && !esUrlWeb(texto)) {
      throw new Error(`Solo se permiten URLs http(s) en ${nombre}`);
    }
    el.setAttribute(nombre, texto);
  }
}

function agregar(el: Element, hijos: readonly Hijo[]): void {
  for (const hijo of hijos) el.append(typeof hijo === "string" ? document.createTextNode(hijo) : hijo);
}

/** Arma un elemento HTML. Los strings son siempre texto; ningún camino interpreta HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  atributos: Atributos = {},
  ...hijos: Hijo[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  aplicar(el, atributos);
  agregar(el, hijos);
  return el;
}

/** Igual que `h`, con el namespace de SVG para el sello y el Gantt. */
export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  atributos: Atributos = {},
  ...hijos: Hijo[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS_SVG, tag);
  aplicar(el, atributos);
  agregar(el, hijos);
  return el;
}
