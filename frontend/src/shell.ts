import { alternarTema, iniciarTema, type Tema } from "./tema.ts";

function crearBotonTema(): HTMLButtonElement {
  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "boton-tema";
  boton.textContent = "Tema oscuro";
  const pintar = (tema: Tema): void => {
    boton.setAttribute("aria-pressed", String(tema === "dark"));
  };
  pintar(iniciarTema());
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

  barra.append(marca, espacio, crearBotonTema());

  const principal = document.createElement("main");
  principal.id = "contenido";

  raiz.replaceChildren(barra, principal);
  return principal;
}
