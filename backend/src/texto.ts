export function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

export function normalizar(s: string): string {
  return sinAcentos(s).toLowerCase();
}

export function slugDe(s: string): string {
  return normalizar(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** "1 tarea", "5 tareas". */
export const cantidad = (n: number, singular: string, plural: string): string => `${String(n)} ${n === 1 ? singular : plural}`;

export function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Cita `texto` para el shell: comillas simples, con las simples internas escapadas. */
export const comillas = (texto: string): string => `'${texto.replaceAll("'", `'\\''`)}'`;
