import { existsSync, readFileSync } from "node:fs";
import { objAbierto, str, type Infer } from "../contract/validar.ts";

/** Una línea de transcript de Claude Code: de terceros, así que solo se piden los campos que se usan. */
export const checkLineaTranscript = objAbierto({}, { type: str, aiTitle: str });
export type LineaTranscript = Infer<typeof checkLineaTranscript>;

/** Lee un transcript saltando las líneas ilegibles (cortadas o con otra forma) y contándolas. */
export function lineasDeTranscript(transcript: string): { lineas: LineaTranscript[]; ilegibles: number } {
  const lineas: LineaTranscript[] = [];
  let ilegibles = 0;
  if (!existsSync(transcript)) return { lineas, ilegibles };
  for (const linea of readFileSync(transcript, "utf8").split("\n")) {
    if (linea.trim() === "") continue;
    try {
      lineas.push(checkLineaTranscript(JSON.parse(linea), "transcript"));
    } catch {
      ilegibles++; // Un transcript puede quedar cortado a mitad de línea: el resto sigue sirviendo.
    }
  }
  return { lineas, ilegibles };
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
