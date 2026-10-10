import { svg } from "./dom.ts";

const FRASE = "RESUELTO · SIN CERRAR ·";
const LADO = 150;
const RADIO_ANILLO = 56;

let contador = 0;

/** Sello de "resuelto sin cerrar": disco lavanda con el texto en anillo. Es decorativo; el tipo se escribe aparte en la lámina. */
export function crearSello(): SVGSVGElement {
  // Cada sello necesita su propio id: el textPath lo referencia y puede haber varios en pantalla.
  const idAnillo = `sello-anillo-${++contador}`;
  const centro = LADO / 2;
  const circunferencia = 2 * Math.PI * RADIO_ANILLO;

  return svg(
    "svg",
    { class: "sello-svg", viewBox: `0 0 ${LADO} ${LADO}`, width: LADO, height: LADO, "aria-hidden": "true", focusable: "false" },
    svg("circle", { class: "sello-disco", cx: centro, cy: centro, r: centro - 2 }),
    svg("circle", { class: "sello-borde", cx: centro, cy: centro, r: centro - 8 }),
    svg("circle", { class: "sello-borde", cx: centro, cy: centro, r: 32 }),
    svg("path", { class: "sello-tilde", d: `M${centro - 12} ${centro + 1} l8 9 l16 -19` }),
    svg(
      "g",
      { class: "sello-giro" },
      svg("path", {
        id: idAnillo,
        fill: "none",
        d: `M${centro} ${centro - RADIO_ANILLO} a${RADIO_ANILLO} ${RADIO_ANILLO} 0 1 1 0 ${2 * RADIO_ANILLO} a${RADIO_ANILLO} ${RADIO_ANILLO} 0 1 1 0 ${-2 * RADIO_ANILLO}`,
      }),
      svg(
        "text",
        { class: "sello-texto" },
        svg("textPath", { href: `#${idAnillo}`, textLength: circunferencia - 4, lengthAdjust: "spacing" }, FRASE),
      ),
    ),
  );
}
