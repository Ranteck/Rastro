import type { Tarea } from "../../../backend/src/contract/snapshot.ts";
import { aMs, formatearDia } from "./fecha.ts";

const DIA_MS = 86_400_000;
const DIA_SEMANA = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short" });

const NUMERO = new Intl.NumberFormat("es-AR");

/** "d" es un día de tiempo libre y "h" son horas; el decimal va con coma, como en plan.md. */
export function formatearDuracion(duracion: Tarea["duracion"]): string {
  return duracion === null ? "sin estimar" : `${NUMERO.format(duracion.valor)} ${duracion.unidad}`;
}

/** Agrupa los días en tramos de días consecutivos. */
export function tramosDeDias(dias: readonly string[]): string[][] {
  const tramos: string[][] = [];
  for (const dia of dias) {
    const tramo = tramos[tramos.length - 1];
    const previo = tramo?.[tramo.length - 1];
    if (tramo !== undefined && previo !== undefined && aMs(dia) - aMs(previo) === DIA_MS) tramo.push(dia);
    else tramos.push([dia]);
  }
  return tramos;
}

/** Los días consecutivos se agrupan ("lun–mié"); los salteados quedan separados ("lun, mié"). */
export function formatearDias(dias: readonly string[]): string {
  return tramosDeDias(dias)
    .map((tramo) => {
      const nombres = [tramo[0], tramo[tramo.length - 1]].map((dia) => formatearDia(DIA_SEMANA, dia ?? ""));
      return tramo.length === 1 ? (nombres[0] ?? "") : nombres.join("–");
    })
    .join(", ");
}

/** Duración y días de una tarea en una línea de datos; lo que no tiene no se inventa. */
export function formatearTiempo(tarea: Tarea): string {
  return [formatearDuracion(tarea.duracion), ...(tarea.dias.length === 0 ? [] : [formatearDias(tarea.dias)])].join(" · ");
}
