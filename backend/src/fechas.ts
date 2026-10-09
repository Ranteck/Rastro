export type Fecha = string;

const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

function aUtc(f: Fecha): Date {
  const m = RE_FECHA.exec(f);
  if (m === null) throw new Error(`fecha inválida: ${f}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function fechaLocal(d: Date, zona: string): Fecha {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function horaLocal(d: Date, zona: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zona, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

export function sumarDias(f: Fecha, dias: number): Fecha {
  const d = aUtc(f);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function lunesDe(f: Fecha): Fecha {
  return sumarDias(f, -((aUtc(f).getUTCDay() + 6) % 7));
}

export function ddmm(f: Fecha): string {
  return `${f.slice(8, 10)}/${f.slice(5, 7)}`;
}

/** Los planes de daily-flock dicen "05/10" sin año: se resuelve contra `referencia`. */
export function desdeDdmm(texto: string, referencia: Fecha): Fecha {
  const m = /^(\d{2})\/(\d{2})$/.exec(texto);
  if (m === null) throw new Error(`fecha DD/MM inválida: ${texto}`);
  const anio = Number(referencia.slice(0, 4));
  const candidata = `${anio}-${m[2]}-${m[1]}`;
  // Un plan de fines de diciembre leído en enero es del año anterior.
  return candidata > sumarDias(referencia, 7) ? `${anio - 1}-${m[2]}-${m[1]}` : candidata;
}

export function diasEntre(desde: Date, hasta: Date): number {
  return Math.floor((hasta.getTime() - desde.getTime()) / 86_400_000);
}
