export const REDACTADO = "[redactado]";

const TOKENS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{10,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/g,
];

// Cubre FOO_KEY=..., API_TOKEN="...", SECRET=..., KEY=..., password=... y --password=...
// El valor sin cerrar corta en espacios, comillas y barras para no comerse el cierre de un string JSON;
// admite una comilla de apertura (con o sin escapar) para no filtrar valores sin comilla de cierre.
const ASIGNACIONES = /\b((?:[A-Za-z_][A-Za-z0-9_]*)?(?:KEY|TOKEN|SECRET|PASSWORD))\s*=\s*("[^"]*"|'[^']*'|\\?["']?[^\s"'\\]+)/gi;

export function redactar(texto: string): string {
  let r = texto;
  for (const re of TOKENS) r = r.replace(re, REDACTADO);
  return r.replace(ASIGNACIONES, (_m, nombre: string) => `${nombre}=${REDACTADO}`);
}
