import { fechaLocal, type Fecha } from "../fechas.ts";
import type { PromptUsuario } from "../fuentes/claudeCode.ts";
import type { Comando } from "../fuentes/zsh.ts";
import { redactar } from "../redactar.ts";
import { normalizar } from "../texto.ts";

export type Umbrales = { veces: number; dias: number; ventanaMin: number };
export type Patron = { fuente: "zsh" | "claude-code"; patron: string; ocurrencias: number; dias: number };

const TRIVIALES = new Set(["ls", "ll", "la", "l", "cd", "pwd", "clear", "exit", "history", "git status", "git diff", "git log"]);
const MAX_SECUENCIA = 4;
const MAX_PATRONES = 5;

function normalizarToken(t: string): string {
  if (/^https?:\/\//.test(t)) return "<url>";
  if (/^[0-9a-f]{7,40}$/.test(t)) return "<hash>";
  if (/^\d+$/.test(t)) return "<n>";
  if (t.includes("/") || t.startsWith("~")) return "<ruta>";
  return t;
}

export function normalizarComando(comando: string): string | null {
  const tokens = comando.trim().split(/\s+/).filter((t) => t !== "").map(normalizarToken);
  const texto = tokens.join(" ");
  if (texto === "" || TRIVIALES.has(tokens[0] ?? "") || TRIVIALES.has(tokens.slice(0, 2).join(" "))) return null;
  return texto;
}

export function patronesDeComandos(comandos: readonly Comando[], u: Umbrales, zona: string): Patron[] {
  const normalizados = comandos
    .map((c) => ({ en: c.en, t: normalizarComando(c.texto) }))
    .filter((c): c is { en: Date; t: string } => c.t !== null)
    .sort((a, b) => a.en.getTime() - b.en.getTime());
  // Una "sesión" de terminal se corta cuando pasan más de ventanaMin minutos entre comandos.
  const sesiones: { en: Date; t: string }[][] = [];
  for (const c of normalizados) {
    const actual = sesiones.at(-1);
    const previo = actual?.at(-1);
    if (actual !== undefined && previo !== undefined && c.en.getTime() - previo.en.getTime() <= u.ventanaMin * 60_000) actual.push(c);
    else sesiones.push([c]);
  }
  const conteo = new Map<string, { ocurrencias: number; dias: Set<Fecha>; largo: number }>();
  for (const s of sesiones) {
    for (let n = 1; n <= MAX_SECUENCIA; n++) {
      for (let i = 0; i + n <= s.length; i++) {
        const ventana = s.slice(i, i + n);
        const primero = ventana[0];
        if (primero === undefined) continue;
        // Un comando suelto solo vale la pena si es largo; "a → a" no es una secuencia.
        if (n === 1 && primero.t.split(" ").length < 3) continue;
        if (new Set(ventana.map((v) => v.t)).size < n) continue;
        const clave = ventana.map((v) => v.t).join(" → ");
        const e = conteo.get(clave) ?? { ocurrencias: 0, dias: new Set<Fecha>(), largo: n };
        e.ocurrencias++;
        e.dias.add(fechaLocal(primero.en, zona));
        conteo.set(clave, e);
      }
    }
  }
  const candidatos = [...conteo]
    .filter(([, e]) => e.ocurrencias >= u.veces && e.dias.size >= u.dias)
    .sort(([, a], [, b]) => b.largo - a.largo || b.ocurrencias - a.ocurrencias);
  const elegidos: [string, { ocurrencias: number; dias: Set<Fecha> }][] = [];
  for (const [clave, e] of candidatos) {
    // Si la secuencia está contenida en una más larga que se repite igual o más, ya está cubierta.
    const cubierta = elegidos.some(([k, x]) => ` → ${k} → `.includes(` → ${clave} → `) && x.ocurrencias >= e.ocurrencias);
    if (!cubierta) elegidos.push([clave, e]);
  }
  return elegidos.slice(0, MAX_PATRONES).map(([patron, e]): Patron => ({ fuente: "zsh", patron, ocurrencias: e.ocurrencias, dias: e.dias.size }));
}

function palabrasDe(s: string): Set<string> {
  return new Set(normalizar(s).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((p) => p !== ""));
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let comunes = 0;
  for (const x of a) if (b.has(x)) comunes++;
  return comunes / (a.size + b.size - comunes);
}

export function patronesDePrompts(prompts: readonly PromptUsuario[], u: Umbrales, zona: string): Patron[] {
  const grupos: { palabras: Set<string>; ejemplo: string; ocurrencias: number; dias: Set<Fecha> }[] = [];
  for (const p of prompts) {
    const palabras = palabrasDe(p.texto);
    if (palabras.size < 4) continue; // "dale", "sí, acepto": confirmaciones, no pedidos que valga automatizar.
    const dia = fechaLocal(p.en, zona);
    const grupo = grupos.find((g) => jaccard(g.palabras, palabras) >= 0.8);
    if (grupo === undefined) {
      grupos.push({ palabras, ejemplo: redactar(p.texto).replace(/\s+/g, " ").trim().slice(0, 120), // Se redacta antes de cortar: un token cortado a mitad no matchea.
        ocurrencias: 1, dias: new Set([dia]) });
    } else {
      grupo.ocurrencias++;
      grupo.dias.add(dia);
    }
  }
  return grupos
    .filter((g) => g.ocurrencias >= u.veces && g.dias.size >= u.dias)
    .sort((a, b) => b.ocurrencias - a.ocurrencias)
    .slice(0, MAX_PATRONES)
    .map((g): Patron => ({ fuente: "claude-code", patron: g.ejemplo, ocurrencias: g.ocurrencias, dias: g.dias.size }));
}
