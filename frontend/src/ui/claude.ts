import { bloqueCopiable } from "./copiar.ts";
import { h, type Hijo } from "./dom.ts";

/**
 * Lo que se le dice a Claude en Claude Code. Cada frase es un disparador de la skill `rastro` (plugin/skills/rastro/SKILL.md):
 * si deja de serlo, el dashboard estaría mandando a pedir algo que el plugin no entiende.
 */
export const FRASES_CLAUDE = {
  cerrarElDia: "cerrá el día",
  sugerirPlan: "sugerime el plan de este proyecto",
} as const;

/** "Decile a Claude «cerrá el día»": lo que se dice, en el grotesco de lo que escribe una persona. */
export function decile(frase: string): Hijo[] {
  return ["Decile a Claude ", h("span", { class: "frase-claude" }, `«${frase}»`)];
}

/** El comando es la alternativa: va debajo, en un bloque que se copia. */
export function enLaTerminal(comando: string): HTMLElement[] {
  return [h("p", { class: "estado cuerpo meta" }, "o en la terminal:"), ...bloqueCopiable(comando)];
}
