import { checkEquipo, type FilaEquipo } from "../../backend/src/contract/equipo.ts";
import { validarSnapshot, type Snapshot } from "../../backend/src/contract/snapshot.ts";
import { RE_SLUG } from "../../backend/src/contract/validar.ts";

export type TipoErrorApi = "central" | "no-encontrada" | "contrato";

const MENSAJES: Record<TipoErrorApi, string> = {
  central: "No pude hablar con el central",
  "no-encontrada": "No encontré a esa persona",
  contrato: "El central devolvió datos que no entiendo",
};

export class ErrorApi extends Error {
  override name = "ErrorApi";
  readonly tipo: TipoErrorApi;

  constructor(tipo: TipoErrorApi, causa?: unknown) {
    super(MENSAJES[tipo], causa === undefined ? undefined : { cause: causa });
    this.tipo = tipo;
  }
}

export interface Api {
  cargarEquipo(): Promise<FilaEquipo[]>;
  cargarPersona(id: string): Promise<Snapshot>;
}

export type Fuente = "central" | "ejemplos";

export interface OpcionesApi {
  fuente?: Fuente;
  fetch?: typeof fetch;
}

/** Los ejemplos no existen en `dist/`: fuera del dev server una variable olvidada no puede activar el modo. */
export function fuenteDeEntorno(): Fuente {
  return import.meta.env.DEV && import.meta.env["VITE_RASTRO_FUENTE"] === "ejemplos" ? "ejemplos" : "central";
}

export function crearApi({ fuente = fuenteDeEntorno(), fetch: pedir = (...args) => fetch(...args) }: OpcionesApi = {}): Api {
  const rutaEquipo = fuente === "ejemplos" ? "./ejemplos/equipo.json" : "/api/equipo";
  const rutaPersona = (id: string): string =>
    fuente === "ejemplos" ? `./ejemplos/persona-${id}.json` : `/api/persona/${id}`;

  async function pedirJson(ruta: string, sinRecurso: TipoErrorApi): Promise<unknown> {
    let res: Response;
    try {
      res = await pedir(ruta);
    } catch (causa) {
      throw new ErrorApi("central", causa);
    }
    // El dev server de Vite responde 200 con index.html a lo que no existe: sin JSON no hay ejemplo.
    const noEsJson = fuente === "ejemplos" && !(res.headers.get("content-type") ?? "").includes("json");
    if (res.status === 404 || noEsJson) throw new ErrorApi(sinRecurso, new Error(`${ruta}: ${res.status}`));
    if (!res.ok) throw new ErrorApi("central", new Error(`${ruta}: ${res.status}`));
    try {
      return await res.json();
    } catch (causa) {
      throw new ErrorApi("contrato", causa);
    }
  }

  return {
    async cargarEquipo() {
      const crudo = await pedirJson(rutaEquipo, "central");
      try {
        return checkEquipo(crudo, "equipo").equipo;
      } catch (causa) {
        throw new ErrorApi("contrato", causa);
      }
    },

    async cargarPersona(id) {
      if (!RE_SLUG.test(id)) throw new ErrorApi("no-encontrada", new Error(`id inválido: ${id}`));
      const crudo = await pedirJson(rutaPersona(encodeURIComponent(id)), "no-encontrada");
      try {
        return validarSnapshot(crudo);
      } catch (causa) {
        throw new ErrorApi("contrato", causa);
      }
    },
  };
}
