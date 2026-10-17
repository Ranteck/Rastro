import { arr, bool, duracion, fecha, fechasOrdenadas, hora, lit, nullable, num, numPositivo, obj, patron, slug, str, type Check, type Infer } from "./validar.ts";

const rango = obj({ desde: fecha, hasta: fecha });
const evidencia = obj({ tipo: lit("commit", "rama", "doc", "sesion"), ref: str }, { url: str });

const tareaV1 = { slug, nombre: str, objetivo: str, estado: lit("pendiente", "hecha", "sacada") };
const barraV1 = { tarea: str, plan: nullable(rango), real: nullable(rango) };
const planV1 = obj({ semana: fecha, entregable: str, tareas: arr(obj(tareaV1)) });

const bitacora = <V extends string, E extends Record<string, Check<unknown>>>(vinculo: Check<V>, extra: E) =>
  arr(
    obj(
      {
        fecha,
        hora,
        tarea: nullable(str),
        rama: str,
        texto: str,
        vinculo,
        evidencia: arr(evidencia),
        ...extra,
      },
      { razon: str },
    ),
  );

const tareaV2 = { ...tareaV1, duracion, dias: fechasOrdenadas, noEntra: bool };
const barraV2 = { ...barraV1, atrasada: bool };
// null es "sin repo" (una reunión, por ejemplo); si no, el nombre corto de un repo observado.
const nombreDeRepo = patron(/\S/, "un nombre de repo no vacío");
const repoDeTarea = nullable(nombreDeRepo);

// Lo que v1, v2 y v3 comparten: v2 reemplaza solo plan, desvios, gantt y el vínculo "corregido", y suma foco y ofrecimientos; v3 suma el repo de cada tarea, entrada y barra.
const comun = {
  generadoEn: str,
  persona: obj({ id: slug, nombre: str, equipo: str }),
  repo: obj({ nombre: str }, { url: str }),
  periodo: rango,
  pendientes: arr(
    obj({
      tipo: lit("resuelto-sin-cerrar", "cerrado-sin-evidencia", "rama-quieta", "todo-nuevo", "codigo-sin-doc"),
      tarea: nullable(str),
      texto: str,
      evidencia: arr(evidencia),
      proximoPaso: str,
    }),
  ),
  resumen: nullable(obj({ hice: arr(str), avance: arr(str), sigue: arr(str), bloqueos: arr(str) })),
  sugerencias: arr(
    obj({
      fuente: lit("zsh", "claude-code"),
      patron: str,
      ocurrencias: num,
      dias: num,
      propuesta: obj({ tipo: lit("alias", "script", "hook", "skill"), contenido: str, porque: str }),
    }),
  ),
  costo: obj({ llamadas: num, usd: num, tokens: num }),
};

const checkSnapshotV1 = obj({
  schemaVersion: lit(1),
  ...comun,
  bitacora: bitacora(lit("nombre", "inferido", "sin-tarea"), {}),
  plan: nullable(planV1),
  desvios: obj({ fueraDelPlanPct: num, alerta: bool, tareasSinActividad: arr(str) }),
  gantt: obj({ mock: lit(true), barras: arr(obj(barraV1)) }),
});

const vinculoV2 = lit("nombre", "inferido", "sin-tarea", "corregido");
const desviosV2 = obj({ fueraDelPlanPct: num, alerta: bool, tareasSinActividad: arr(str), tareasAtrasadas: arr(slug) });
const focoV2 = nullable(obj({ actual: nullable(slug), siguiente: nullable(slug) }));
const ofrecimientosV2 = arr(obj({ id: slug, nombre: str, objetivo: str, duracion, porque: str }));

const checkSnapshotV2 = obj({
  schemaVersion: lit(2),
  ...comun,
  bitacora: bitacora(vinculoV2, {}),
  plan: nullable(obj({ semana: fecha, entregable: str, tareas: arr(obj(tareaV2)) })),
  desvios: desviosV2,
  foco: focoV2,
  ofrecimientos: ofrecimientosV2,
  gantt: obj({ mock: bool, barras: arr(obj(barraV2)) }),
});

// v3 suma el repo de la tarea sugerida y el estado con que entraría al plan; ausentes son "sin repo" y "pendiente".
const ofrecimientosV3 = arr(
  obj({ id: slug, nombre: str, objetivo: str, duracion, porque: str }, { repo: repoDeTarea, estadoSugerido: lit("pendiente", "hecha") }),
);

const checkSnapshotV3 = obj({
  schemaVersion: lit(3),
  ...comun,
  bitacora: bitacora(vinculoV2, { repo: repoDeTarea }),
  plan: nullable(obj({ semana: fecha, entregable: str, tareas: arr(obj({ ...tareaV2, repo: repoDeTarea })) })),
  desvios: desviosV2,
  foco: focoV2,
  ofrecimientos: ofrecimientosV3,
  gantt: obj({ mock: bool, barras: arr(obj(barraV2, { repo: nombreDeRepo })) }),
});

export type Snapshot = Infer<typeof checkSnapshotV3>;
export type Evidencia = Infer<typeof evidencia>;
export type Plan = NonNullable<Snapshot["plan"]>;
export type Tarea = Plan["tareas"][number];
export type EntradaBitacora = Snapshot["bitacora"][number];
export type Pendiente = Snapshot["pendientes"][number];
export type Desvios = Snapshot["desvios"];
export type Resumen = NonNullable<Snapshot["resumen"]>;
export type Sugerencia = Snapshot["sugerencias"][number];
export type Ofrecimiento = Snapshot["ofrecimientos"][number];
export type Gantt = Snapshot["gantt"];
export type Costo = Snapshot["costo"];

type SnapshotV1 = Infer<typeof checkSnapshotV1>;
type SnapshotV2 = Infer<typeof checkSnapshotV2>;

function desdeV2(v2: SnapshotV2): Snapshot {
  return {
    ...v2,
    schemaVersion: 3,
    bitacora: v2.bitacora.map((e) => ({ ...e, repo: null })),
    plan: v2.plan === null ? null : { ...v2.plan, tareas: v2.plan.tareas.map((t) => ({ ...t, repo: null })) },
  };
}

function desdeV1(v1: SnapshotV1): Snapshot {
  return desdeV2({
    ...v1,
    schemaVersion: 2,
    plan: v1.plan === null ? null : { ...v1.plan, tareas: v1.plan.tareas.map((t) => ({ ...t, duracion: null, dias: [], noEntra: false })) },
    desvios: { ...v1.desvios, tareasAtrasadas: [] },
    foco: null,
    ofrecimientos: [],
    gantt: { ...v1.gantt, barras: v1.gantt.barras.map((b) => ({ ...b, atrasada: false })) },
  });
}

/** Acepta v1, v2 y v3 y devuelve siempre v3: así el central y el modo equipo siguen recibiendo snapshots viejos. */
export function validarSnapshot(raw: unknown): Snapshot {
  const version = typeof raw === "object" && raw !== null ? (raw as { schemaVersion?: unknown }).schemaVersion : undefined;
  if (version === 1) return desdeV1(checkSnapshotV1(raw, "snapshot"));
  if (version === 2) return desdeV2(checkSnapshotV2(raw, "snapshot"));
  return checkSnapshotV3(raw, "snapshot");
}
