import type { Snapshot } from "../contract/snapshot.ts";

export interface Conector {
  readonly nombre: string;
  /** Publica el snapshot. Devuelve qué hizo; si falla, lanza. */
  publicar(s: Snapshot): Promise<string>;
}
