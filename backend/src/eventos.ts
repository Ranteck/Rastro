import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { lit, nullable, obj, str, type Check, type Infer } from "./contract/validar.ts";

const checkEventoCommit = obj({ tipo: lit("commit"), sha: str, rama: str, en: str });
const checkEventoSesion = obj({ tipo: lit("sesion"), id: str, transcript: str, rama: nullable(str), en: str });

export type Evento = Infer<typeof checkEventoCommit> | Infer<typeof checkEventoSesion>;

const checkEvento: Check<Evento> = (v, r) =>
  typeof v === "object" && v !== null && (v as { tipo?: unknown }).tipo === "commit" ? checkEventoCommit(v, r) : checkEventoSesion(v, r);

export function agregarEvento(archivo: string, evento: Evento): void {
  mkdirSync(dirname(archivo), { recursive: true });
  appendFileSync(archivo, `${JSON.stringify(evento)}\n`);
}

export function leerEventos(archivo: string): { eventos: Evento[]; descartados: number } {
  if (!existsSync(archivo)) return { eventos: [], descartados: 0 };
  const eventos: Evento[] = [];
  let descartados = 0;
  for (const linea of readFileSync(archivo, "utf8").split("\n")) {
    if (linea.trim() === "") continue;
    try {
      eventos.push(checkEvento(JSON.parse(linea), "evento"));
    } catch {
      descartados++; // Una línea rota (un hook cortado a mitad de escritura) no invalida el resto: se cuenta y se informa.
    }
  }
  return { eventos, descartados };
}
