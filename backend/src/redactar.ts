export const REDACTADO = "[redactado]";

const TOKENS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-[A-Za-z0-9_-]{10,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/g,
];

// Cubre FOO_KEY=..., API_TOKEN="...", SECRET=..., KEY=..., password=... y --password=...
// Alternativas del valor, en orden: comillas escapadas, comillas cerradas (pueden abarcar líneas, como una
// clave PEM; lo pegado a la comilla de cierre también es parte del valor), comilla sin cerrar (hasta fin de
// línea), valor sin comillas y valor vacío.
const VALOR = [
  String.raw`\\"(?:[^"\\]|\\.)*?\\"`,
  String.raw`"[^"]*"[^\s"']*`,
  String.raw`'[^']*'[^\s"']*`,
  String.raw`\\?"[^"\n]*$`,
  String.raw`\\?'[^'\n]*$`,
  String.raw`[^\s"']+`,
  String.raw`(?=["']|\s|$)`,
].join("|");
const ASIGNACIONES = new RegExp(String.raw`\b((?:[A-Za-z_][A-Za-z0-9_]*)?(?:KEY|TOKEN|SECRET|PASSWORD))\s*=\s*(?:${VALOR})`, "gim");

// Trabaja sobre texto plano, nunca sobre JSON serializado: quien serializa redacta cada string antes.
export function redactar(texto: string): string {
  let r = texto;
  for (const re of TOKENS) r = r.replace(re, REDACTADO);
  // El grupo de la contraseña llega hasta la última "@" antes de la ruta: una contraseña con "@" crudo no deja cola.
  r = r.replace(/\b([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/]*@/g, `$1${REDACTADO}@`);
  return r.replace(ASIGNACIONES, (_m, nombre: string) => `${nombre}=${REDACTADO}`);
}
