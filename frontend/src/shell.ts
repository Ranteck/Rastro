import { ETIQUETAS_VISTA, VISTAS_PERSONA, hashDe, type Ruta } from "./router.ts";
import { h } from "./ui/dom.ts";
import { etiquetaMock } from "./ui/estado.ts";
import { alternarTema, iniciarTema, seguirSistema, type Tema } from "./tema.ts";

function crearBotonTema(): HTMLButtonElement {
  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "boton-tema";
  const pintar = (tema: Tema): void => {
    boton.textContent = tema === "dark" ? "Tema claro" : "Tema oscuro";
  };
  pintar(iniciarTema());
  seguirSistema(pintar);
  boton.addEventListener("click", () => pintar(alternarTema()));
  return boton;
}

/** Monta la barra fija y devuelve el `<main>` donde van las vistas. */
export function montarShell(raiz: HTMLElement, modoEjemplos = false): HTMLElement {
  const barra = document.createElement("header");
  barra.className = "barra";

  const marca = document.createElement("span");
  marca.className = "marca";
  marca.textContent = "RASTRO";

  const espacio = document.createElement("span");
  espacio.className = "barra-espacio";

  barra.append(
    marca,
    h("nav", { class: "navegacion", "aria-label": "Secciones" }),
    espacio,
    ...(modoEjemplos ? [etiquetaMock("MODO EJEMPLOS")] : []),
    crearBotonTema(),
  );

  // Fuera de <main>: el repintado de la vista no la borra, y así el resultado de una edición se anuncia y queda a la vista (pegado bajo la barra).
  // Con tabindex para recibir el foco tras aplicar un cambio cuando el control editado ya no existe.
  const anuncio = h("div", { class: "anuncio", role: "status", "aria-live": "polite", tabindex: "-1" });

  const principal = document.createElement("main");
  principal.id = "contenido";
  principal.tabIndex = -1;

  raiz.replaceChildren(barra, anuncio, principal);
  return principal;
}

function pestana(texto: string, hash: string, activa: boolean): HTMLAnchorElement {
  return h("a", { class: "pestana", href: hash, "aria-current": activa ? "page" : null }, texto);
}

/**
 * Repinta las pestañas según la ruta; `nombre` es el de la persona si ya se conoce, y si no se usa el id.
 * `conChat` suma la pestaña "Chat". `conEquipo` es false en la sesión personal: el modo equipo está en pausa y no se ofrece.
 */
export function pintarNavegacion(raiz: HTMLElement, ruta: Ruta, nombre?: string, conChat = false, conEquipo = true): void {
  const nav = raiz.querySelector(".navegacion");
  if (!nav) throw new Error("Falta la navegación del shell");
  const items: Node[] = conEquipo ? [pestana("Equipo", "#/equipo", ruta.tipo === "equipo")] : [];
  if (ruta.tipo === "persona") {
    items.push(h("span", { class: "token-persona" }, nombre ?? ruta.id));
    for (const vista of VISTAS_PERSONA.filter((v) => v !== "chat" || conChat)) {
      const destino = { tipo: "persona", id: ruta.id, vista } as const;
      items.push(pestana(ETIQUETAS_VISTA[vista], hashDe(destino), vista === ruta.vista));
    }
  }
  nav.replaceChildren(...items);
  // En pantallas angostas la barra de pestañas se desplaza: la activa tiene que quedar a la vista.
  nav.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
