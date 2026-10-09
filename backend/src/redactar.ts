export const REDACTADO = "[redactado]";

const TOKENS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{10,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/g,
];

// Cubre FOO_KEY=..., API_TOKEN="...", SECRET=..., KEY=..., password=... y --password=...
// Alternativas del valor, en orden: comillas escapadas (dentro de un string JSON), comillas cerradas, comilla
// sin cerrar (hasta fin de línea), valor sin comillas y valor vacío. Una comilla de cierre seguida de una
// letra no cierra un valor: es `KEY=","x"` en JSON, una asignación vacía, y no debe consumir las comillas ajenas.
const VALOR = [
  String.raw`\\"(?:[^"\\]|\\.)*?\\"`,
  String.raw`"[^"\n]*"(?!\w)`,
  String.raw`'[^'\n]*'(?!\w)`,
  String.raw`\\?"[^"\n]*$`,
  String.raw`\\?'[^'\n]*$`,
  String.raw`[^\s"']+`,
  String.raw`(?=["']|\s|$)`,
].join("|");
const ASIGNACIONES = new RegExp(String.raw`\b((?:[A-Za-z_][A-Za-z0-9_]*)?(?:KEY|TOKEN|SECRET|PASSWORD))\s*=\s*(?:${VALOR})`, "gim");

export function redactar(texto: string): string {
  let r = texto;
  for (const re of TOKENS) r = r.replace(re, REDACTADO);
  return r.replace(ASIGNACIONES, (_m, nombre: string) => `${nombre}=${REDACTADO}`);
}
