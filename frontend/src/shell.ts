import { ETIQUETAS_VISTA, VISTAS_PERSONA, hashDe, type Ruta } from "./router.ts";
import { h } from "./ui/dom.ts";
import { alternarTema, iniciarTema, seguirSistema, type Tema } from "./tema.ts";

function crearBotonTema(): HTMLButtonElement {
  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "boton-tema";
  boton.textContent = "Tema oscuro";
  const pintar = (tema: Tema): void => {
    boton.setAttribute("aria-pressed", String(tema === "dark"));
  };
  pintar(iniciarTema());
  seguirSistema(pintar);
  boton.addEventListener("click", () => pintar(alternarTema()));
  return boton;
}

/** Monta la barra fija y devuelve el `<main>` donde van las vistas. */
export function montarShell(raiz: HTMLElement): HTMLElement {
  const barra = document.createElement("header");
  barra.className = "barra";

  const marca = document.createElement("span");
  marca.className = "marca";
  marca.textContent = "RASTRO";

  const espacio = document.createElement("span");
  espacio.className = "barra-espacio";

  barra.append(marca, h("nav", { class: "navegacion", "aria-label": "Secciones" }), espacio, crearBotonTema());

  const principal = document.createElement("main");
  principal.id = "contenido";

  raiz.replaceChildren(barra, principal);
  return principal;
}

function pestana(texto: string, hash: string, activa: boolean): HTMLAnchorElement {
  return h("a", { class: "pestana", href: hash, "aria-current": activa ? "page" : null }, texto);
}

/** Repinta las pestañas según la ruta; `nombre` es el de la persona si ya se conoce, y si no se usa el id. */
export function pintarNavegacion(raiz: HTMLElement, ruta: Ruta, nombre?: string): void {
  const nav = raiz.querySelector(".navegacion");
  if (!nav) throw new Error("Falta la navegación del shell");
  const items: Node[] = [pestana("Equipo", "#/equipo", ruta.tipo === "equipo")];
  if (ruta.tipo === "persona") {
    items.push(h("span", { class: "token-persona" }, nombre ?? ruta.id));
    for (const vista of VISTAS_PERSONA) {
      const destino = { tipo: "persona", id: ruta.id, vista } as const;
      items.push(pestana(ETIQUETAS_VISTA[vista], hashDe(destino), vista === ruta.vista));
    }
  }
  nav.replaceChildren(...items);
}
