import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { bool, desconocido, objAbierto, str, type Infer } from "../contract/validar.ts";

export type PromptUsuario = { en: Date; texto: string; sesion: string };

/** Una línea de transcript de Claude Code: de terceros, así que solo se piden los campos que se usan. */
export const checkLineaTranscript = objAbierto(
  {},
  {
    type: str,
    aiTitle: str,
    message: desconocido,
    timestamp: str,
    sessionId: str,
    isSidechain: bool,
    isMeta: bool,
  },
);
// El mensaje se valida aparte: una línea con otro `message` sigue sirviendo para el título de la sesión.
const checkMensaje = objAbierto({}, { content: desconocido });
export type LineaTranscript = Infer<typeof checkLineaTranscript>;

function lineasDeContenido(contenido: string): { lineas: LineaTranscript[]; ilegibles: number } {
  const lineas: LineaTranscript[] = [];
  let ilegibles = 0;
  for (const linea of contenido.split("\n")) {
    if (linea.trim() === "") continue;
    try {
      lineas.push(checkLineaTranscript(JSON.parse(linea), "transcript"));
    } catch {
      ilegibles++; // Un transcript puede quedar cortado a mitad de línea: el resto sigue sirviendo.
    }
  }
  return { lineas, ilegibles };
}

/** Lee un transcript saltando las líneas ilegibles (cortadas o con otra forma) y contándolas. */
export function lineasDeTranscript(transcript: string): { lineas: LineaTranscript[]; ilegibles: number } {
  if (!existsSync(transcript)) return { lineas: [], ilegibles: 0 };
  return lineasDeContenido(readFileSync(transcript, "utf8"));
}

/** Prompts escritos por la persona. Se excluyen tool results, comandos y avisos (empiezan con "<") y subagentes. */
export function promptsDeTranscript(contenido: string): { prompts: PromptUsuario[]; descartadas: number } {
  const { lineas, ilegibles } = lineasDeContenido(contenido);
  const prompts: PromptUsuario[] = [];
  for (const l of lineas) {
    if (l.type !== "user" || l.isSidechain === true || l.isMeta === true) continue;
    let texto: unknown;
    try {
      texto = checkMensaje(l.message, "message").content;
    } catch {
      continue; // No es un mensaje de persona (otra forma): no es un prompt y no cuenta como línea ilegible.
    }
    if (typeof texto !== "string" || texto.trimStart().startsWith("<") || l.timestamp === undefined || l.sessionId === undefined) continue;
    const en = new Date(l.timestamp);
    if (!Number.isNaN(en.getTime())) prompts.push({ en, texto, sesion: l.sessionId });
  }
  return { prompts, descartadas: ilegibles };
}

/** Claude Code guarda los transcripts de cada proyecto en un directorio con la ruta del repo sin separadores. */
export function dirDeProyecto(repo: string): string {
  return repo.replace(/[^a-zA-Z0-9]/g, "-");
}

/** Transcripts (`<dir>/<sesion>.jsonl`) modificados desde `desde`. */
export function transcriptsRecientes(dir: string, desde: Date): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((f) => f.isFile() && f.name.endsWith(".jsonl"))
    .map((f) => join(dir, f.name))
    .filter((ruta) => statSync(ruta).mtime >= desde);
}

/** El título que Claude Code le pone a la sesión (línea "ai-title" del transcript); el último gana. */
export function leerTranscript(transcript: string): { titulo: string | null; ilegibles: number } {
  const { lineas, ilegibles } = lineasDeTranscript(transcript);
  let titulo: string | null = null;
  for (const l of lineas) if (l.type === "ai-title" && l.aiTitle !== undefined) titulo = l.aiTitle;
  return { titulo, ilegibles };
}

export function tituloDeSesion(transcript: string): string | null {
  return leerTranscript(transcript).titulo;
}
