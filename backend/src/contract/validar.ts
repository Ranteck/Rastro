export class ErrorValidacion extends Error {
  override name = "ErrorValidacion";
  readonly ruta: string;

  constructor(ruta: string, detalle: string) {
    super(`${ruta}: ${detalle}`);
    this.ruta = ruta;
  }
}

export type Check<T> = (valor: unknown, ruta: string) => T;
export type Infer<C> = C extends Check<infer T> ? T : never;
type Forma = Record<string, Check<unknown>>;
type Salida<F extends Forma> = { [K in keyof F]: Infer<F[K]> };
type Primitivo = string | number | boolean;

export const str: Check<string> = (v, r) => {
  if (typeof v !== "string") throw new ErrorValidacion(r, "se esperaba texto");
  return v;
};

export const num: Check<number> = (v, r) => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new ErrorValidacion(r, "se esperaba un número");
  return v;
};

export const bool: Check<boolean> = (v, r) => {
  if (typeof v !== "boolean") throw new ErrorValidacion(r, "se esperaba true o false");
  return v;
};

export const desconocido: Check<unknown> = (v) => v;

export function lit<const L extends readonly Primitivo[]>(...valores: L): Check<L[number]> {
  return (v, r) => {
    if (!valores.some((x) => x === v)) throw new ErrorValidacion(r, `se esperaba uno de: ${valores.join(", ")}`);
    return v as L[number];
  };
}

export function patron(re: RegExp, descripcion: string): Check<string> {
  return (v, r) => {
    const s = str(v, r);
    if (!re.test(s)) throw new ErrorValidacion(r, `se esperaba ${descripcion}`);
    return s;
  };
}

export function arr<T>(c: Check<T>): Check<T[]> {
  return (v, r) => {
    if (!Array.isArray(v)) throw new ErrorValidacion(r, "se esperaba una lista");
    return v.map((x, i) => c(x, `${r}[${i}]`));
  };
}

export function nullable<T>(c: Check<T>): Check<T | null> {
  return (v, r) => (v === null ? null : c(v, r));
}

function comoRegistro(v: unknown, r: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new ErrorValidacion(r, "se esperaba un objeto");
  return v as Record<string, unknown>;
}

function construir<F extends Forma, O extends Forma>(
  reg: Record<string, unknown>,
  r: string,
  requeridos: F,
  opcionales: O,
): Salida<F> & Partial<Salida<O>> {
  const salida: Record<string, unknown> = {};
  for (const [k, c] of Object.entries(requeridos)) salida[k] = c(reg[k], `${r}.${k}`);
  for (const [k, c] of Object.entries(opcionales)) if (reg[k] !== undefined) salida[k] = c(reg[k], `${r}.${k}`);
  return salida as Salida<F> & Partial<Salida<O>>;
}

/** Objeto cerrado: rechaza campos que el contrato no admite. Para datos que define Rastro. */
export function obj<F extends Forma, O extends Forma = Record<never, never>>(
  requeridos: F,
  opcionales?: O,
): Check<Salida<F> & Partial<Salida<O>>> {
  return (v, r) => {
    const reg = comoRegistro(v, r);
    for (const k of Object.keys(reg)) {
      if (!Object.hasOwn(requeridos, k) && !(opcionales !== undefined && Object.hasOwn(opcionales, k))) throw new ErrorValidacion(`${r}.${k}`, "campo no admitido");
    }
    return construir(reg, r, requeridos, opcionales ?? ({} as O));
  };
}

/** Objeto abierto: descarta los campos que no se piden. Para datos de terceros que pueden sumar campos. */
export function objAbierto<F extends Forma, O extends Forma = Record<never, never>>(
  requeridos: F,
  opcionales?: O,
): Check<Salida<F> & Partial<Salida<O>>> {
  return (v, r) => construir(comoRegistro(v, r), r, requeridos, opcionales ?? ({} as O));
}

export const RE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const fecha = patron(/^\d{4}-\d{2}-\d{2}$/, "una fecha AAAA-MM-DD");
export const hora = patron(/^\d{2}:\d{2}$/, "una hora HH:MM");
export const slug = patron(RE_SLUG, "un slug en minúsculas con guiones");
