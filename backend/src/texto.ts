export function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

export function normalizar(s: string): string {
  return sinAcentos(s).toLowerCase();
}

export function slugDe(s: string): string {
  return normalizar(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
