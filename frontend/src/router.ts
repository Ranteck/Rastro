export const VISTAS_PERSONA = ["mi-dia", "pendientes", "plan", "sugerencias"] as const;
export type VistaPersona = (typeof VISTAS_PERSONA)[number];

export type Ruta =
  | { tipo: "equipo" }
  | { tipo: "persona"; id: string; vista: VistaPersona }
  | { tipo: "desconocida" };

export const ETIQUETAS_VISTA: Record<VistaPersona, string> = {
  "mi-dia": "Mi día",
  pendientes: "Pendientes",
  plan: "Plan",
  sugerencias: "Sugerencias",
};

function esVista(valor: string | undefined): valor is VistaPersona {
  return VISTAS_PERSONA.some((v) => v === valor);
}

export function parsearRuta(hash: string): Ruta {
  const camino = hash.replace(/^#/, "").replace(/\/+$/, "");
  if (camino === "" || camino === "/equipo") return { tipo: "equipo" };
  const [vacio, seccion, id, vista, ...resto] = camino.split("/");
  if (vacio === "" && seccion === "persona" && id && esVista(vista) && resto.length === 0) {
    let decodificado: string;
    try {
      decodificado = decodeURIComponent(id);
    } catch {
      // Un id con escapes rotos no puede ser una persona: cae en "página no encontrada".
      return { tipo: "desconocida" };
    }
    return { tipo: "persona", id: decodificado, vista };
  }
  return { tipo: "desconocida" };
}

export function hashDe(ruta: Exclude<Ruta, { tipo: "desconocida" }>): string {
  return ruta.tipo === "equipo" ? "#/equipo" : `#/persona/${encodeURIComponent(ruta.id)}/${ruta.vista}`;
}
