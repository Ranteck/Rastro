import { arr, bool, fecha, hora, lit, nullable, num, obj, slug, str, type Infer } from "./validar.ts";

const rango = obj({ desde: fecha, hasta: fecha });
const evidencia = obj({ tipo: lit("commit", "rama", "doc", "sesion"), ref: str }, { url: str });

export const checkSnapshot = obj({
  schemaVersion: lit(1),
  generadoEn: str,
  persona: obj({ id: slug, nombre: str, equipo: str }),
  repo: obj({ nombre: str }, { url: str }),
  periodo: rango,
  plan: nullable(
    obj({
      semana: fecha,
      entregable: str,
      tareas: arr(obj({ slug, nombre: str, objetivo: str, estado: lit("pendiente", "hecha", "sacada") })),
    }),
  ),
  bitacora: arr(
    obj(
      {
        fecha,
        hora,
        tarea: nullable(str),
        rama: str,
        texto: str,
        vinculo: lit("nombre", "inferido", "sin-tarea"),
        evidencia: arr(evidencia),
      },
      { razon: str },
    ),
  ),
  pendientes: arr(
    obj({
      tipo: lit("resuelto-sin-cerrar", "cerrado-sin-evidencia", "rama-quieta", "todo-nuevo", "codigo-sin-doc"),
      tarea: nullable(str),
      texto: str,
      evidencia: arr(evidencia),
      proximoPaso: str,
    }),
  ),
  desvios: obj({ fueraDelPlanPct: num, alerta: bool, tareasSinActividad: arr(str) }),
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
  gantt: obj({ mock: lit(true), barras: arr(obj({ tarea: str, plan: nullable(rango), real: nullable(rango) })) }),
  costo: obj({ llamadas: num, usd: num, tokens: num }),
});

export type Snapshot = Infer<typeof checkSnapshot>;
export type Evidencia = Infer<typeof evidencia>;
export type Plan = NonNullable<Snapshot["plan"]>;
export type Tarea = Plan["tareas"][number];
export type EntradaBitacora = Snapshot["bitacora"][number];
export type Pendiente = Snapshot["pendientes"][number];
export type Desvios = Snapshot["desvios"];
export type Resumen = NonNullable<Snapshot["resumen"]>;
export type Sugerencia = Snapshot["sugerencias"][number];
export type Gantt = Snapshot["gantt"];
export type Costo = Snapshot["costo"];

export function validarSnapshot(raw: unknown): Snapshot {
  return checkSnapshot(raw, "snapshot");
}
