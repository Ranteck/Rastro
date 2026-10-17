import { DIAS_SEMANA, type Config, type Disponibilidad } from "./config.ts";
import type { Tarea } from "./contract/snapshot.ts";
import { indiceDiaSemana, sumarDias, type Fecha } from "./fechas.ts";
import type { TareaARenderizar } from "./plan.ts";
import { slugDe } from "./texto.ts";

export type TareaARepartir = Pick<Tarea, "slug" | "estado" | "duracion">;

/** `faltante` (en la unidad de la tarea) solo aparece en una fijada a la que no le alcanzan las horas libres de sus días. */
export type Reparto = { slug: string; dias: Fecha[]; noEntra: boolean; faltante?: number };

// Margen para que la suma de fracciones de hora no deje una tarea afuera por redondeo.
const EPSILON = 1e-9;

type DiaLibre = { dia: Fecha; capacidad: number; horas: number };

function horasLibres(dia: Fecha, d: Disponibilidad): number {
  const nombre = DIAS_SEMANA[indiceDiaSemana(dia)];
  if (nombre === undefined || !d.dias.includes(nombre)) return 0;
  const excepcion = d.excepciones.find((e) => e.fecha === dia);
  const ocupadas = excepcion ? excepcion.horas : d.fijos.filter((f) => f.dias.includes(nombre)).reduce((suma, f) => suma + f.horas, 0);
  return Math.max(0, d.horasDia - ocupadas);
}

/** Cuánto de la tarea (en su unidad) se puede hacer en ese día y cuántas horas libres consume. */
function tomarDelDia(libre: DiaLibre, duracion: NonNullable<Tarea["duracion"]>, faltan: number): { cubre: number; horas: number } {
  if (libre.horas <= EPSILON) return { cubre: 0, horas: 0 };
  if (duracion.unidad === "h") {
    const horas = Math.min(libre.horas, faltan);
    return { cubre: horas, horas };
  }
  // Un día de la tarea vale las horas libres de ese día, sean las que sean.
  const cubre = Math.min(libre.horas / libre.capacidad, faltan);
  return { cubre, horas: cubre * libre.capacidad };
}

/**
 * Reparte las tareas pendientes con duración en los días de [desde, hasta], en el orden del plan.
 * Las fijadas consumen primero sus horas, repartidas parejo en sus días; el resto va después.
 */
export function repartir(entrada: {
  tareas: TareaARepartir[];
  desde: Fecha;
  hasta: Fecha;
  disponibilidad: Disponibilidad;
  fijadas?: ReadonlyMap<string, readonly Fecha[]>;
  /** Tareas que se recalculan desde un día anterior a `desde`: las que ya empezaron y cuya duración se corrigió. */
  inicios?: ReadonlyMap<string, Fecha>;
}): Reparto[] {
  const { tareas, desde, hasta, disponibilidad } = entrada;
  const fijadas = entrada.fijadas ?? new Map<string, readonly Fecha[]>();
  const inicios = entrada.inicios ?? new Map<string, Fecha>();
  const primero = [...inicios.values()].reduce((a, b) => (b < a ? b : a), desde);
  const libres: DiaLibre[] = [];
  for (let dia = primero; dia <= hasta; dia = sumarDias(dia, 1)) {
    const horas = horasLibres(dia, disponibilidad);
    libres.push({ dia, capacidad: horas, horas });
  }

  const repartos = new Map<string, Reparto>();
  const activa = (t: TareaARepartir): t is TareaARepartir & { duracion: NonNullable<Tarea["duracion"]> } => t.estado === "pendiente" && t.duracion !== null;

  for (const t of tareas) {
    const dias = fijadas.get(t.slug);
    if (dias === undefined || !activa(t)) continue;
    const porDia = t.duracion.valor / Math.max(1, dias.length);
    let cubierto = 0;
    for (const libre of libres) {
      if (!dias.includes(libre.dia)) continue;
      const { cubre, horas } = tomarDelDia(libre, t.duracion, porDia);
      libre.horas -= horas;
      cubierto += cubre;
    }
    const faltante = t.duracion.valor - cubierto;
    repartos.set(t.slug, { slug: t.slug, dias: [...dias], noEntra: false, ...(faltante > EPSILON ? { faltante } : {}) });
  }

  return tareas.map((t) => {
    const hecho = repartos.get(t.slug);
    if (hecho !== undefined) return hecho;
    if (!activa(t)) return { slug: t.slug, dias: [], noEntra: false };
    let faltan = t.duracion.valor;
    const tomas: { libre: DiaLibre; horas: number }[] = [];
    const inicio = inicios.get(t.slug) ?? desde;
    for (const libre of libres) {
      if (faltan <= EPSILON) break;
      if (libre.dia < inicio) continue;
      const { cubre, horas } = tomarDelDia(libre, t.duracion, faltan);
      if (horas <= EPSILON) continue;
      tomas.push({ libre, horas });
      faltan -= cubre;
    }
    if (faltan > EPSILON) return { slug: t.slug, dias: [], noEntra: true };
    for (const { libre, horas } of tomas) libre.horas -= horas;
    return { slug: t.slug, dias: tomas.map(({ libre }) => libre.dia), noEntra: false };
  });
}

/**
 * Una pendiente que ya empezó según el plan (su primer día es anterior a `desde`) no se mueve: si se la repartiera de nuevo,
 * un cambio cualquiera borraría la señal de atraso. Queda fijada con sus días, salvo las que se re-estimaron (`reestimadas`):
 * esas se recalculan desde su primer día original.
 */
export function conservarEmpezadas(o: {
  tareas: readonly TareaARenderizar[];
  desde: Fecha;
  fijadas: ReadonlyMap<string, readonly Fecha[]>;
  reestimadas?: ReadonlySet<string>;
}): { fijadas: Map<string, readonly Fecha[]>; inicios: Map<string, Fecha> } {
  const fijadas = new Map(o.fijadas);
  const inicios = new Map<string, Fecha>();
  for (const t of o.tareas) {
    const slug = slugDe(t.nombre);
    const primerDia = t.dias?.[0];
    if (t.estado !== undefined && t.estado !== "pendiente") continue;
    if (primerDia === undefined || primerDia >= o.desde || fijadas.has(slug) || t.duracion === undefined || t.duracion === null) continue;
    if (o.reestimadas?.has(slug) === true) inicios.set(slug, primerDia);
    else fijadas.set(slug, t.dias ?? []);
  }
  return { fijadas, inicios };
}

/** Asigna días a las tareas pendientes con duración; las hechas y las sacadas conservan los que tenían, que son lo real contra lo sugerido. */
export function conReparto(o: {
  desde: Fecha;
  semana: Fecha;
  config: Config;
  tareas: readonly TareaARenderizar[];
  fijadas?: ReadonlyMap<string, readonly Fecha[]>;
  inicios?: ReadonlyMap<string, Fecha>;
}): (TareaARenderizar & { faltante?: number })[] {
  const items = o.tareas.map((t) => ({ slug: slugDe(t.nombre), estado: t.estado ?? "pendiente", duracion: t.duracion ?? null }));
  const repartos = repartir({
    tareas: items,
    desde: o.desde,
    hasta: sumarDias(o.semana, 6),
    disponibilidad: o.config.disponibilidad,
    ...(o.fijadas === undefined ? {} : { fijadas: o.fijadas }),
    ...(o.inicios === undefined ? {} : { inicios: o.inicios }),
  });
  return o.tareas.map((t, i) =>
    t.estado === "hecha" || t.estado === "sacada"
      ? { ...t, dias: t.dias ?? [], noEntra: t.noEntra ?? false }
      : { ...t, dias: repartos[i]?.dias ?? [], noEntra: repartos[i]?.noEntra ?? false, ...(repartos[i]?.faltante === undefined ? {} : { faltante: repartos[i]?.faltante ?? 0 }) },
  );
}
