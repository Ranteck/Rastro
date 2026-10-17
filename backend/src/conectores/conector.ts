import type { Snapshot } from "../contract/snapshot.ts";

export type OpcionesPublicacion = {
  /** El plan de la semana cambió desde la última publicación: los conectores que lo usan lo incluyen. */
  conPlan?: boolean;
  /**
   * Con conPlan: la página de Notion ya tiene el plan de esta semana y estos son los cambios a aplicarle (agregadas, sacadas, campos
   * cambiados). Sin ellos, el conector lleva el plan completo y deja que se adapte al formato de la página.
   */
  cambiosPlan?: readonly string[];
};

export interface Conector {
  readonly nombre: string;
  /** Publica el snapshot. Devuelve qué hizo; si falla, lanza. */
  publicar(s: Snapshot, opciones?: OpcionesPublicacion): Promise<string>;
}
