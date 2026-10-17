import { checkEquipo, type FilaEquipo } from "../../backend/src/contract/equipo.ts";
import { validarSnapshot, type Snapshot } from "../../backend/src/contract/snapshot.ts";
import { checkCambios, type Cambio } from "../../backend/src/contract/cambios.ts";
import { arr, bool, desconocido, lit, nullable, num, obj, objAbierto, RE_SLUG, slug, str, type Check, type Infer } from "../../backend/src/contract/validar.ts";

export type TipoErrorApi = "central" | "no-encontrada" | "contrato" | "reiniciado" | "rechazado" | "sin-sesion" | "en-curso";

const MENSAJES: Record<TipoErrorApi, string> = {
  central: "No pude hablar con el central",
  "no-encontrada": "No encontré a esa persona",
  contrato: "El central devolvió datos que no entiendo",
  reiniciado: "El central rechazó el pedido: recargá la página. Si estás usando `npm run dev`, abrí el dashboard desde `rastro serve`.",
  // Lo reemplaza el mensaje del central.
  rechazado: "El central rechazó el cambio",
  "sin-sesion": "Para editar hace falta el central en modo personal",
  "en-curso": "Ya hay un mensaje en curso",
};

export class ErrorApi extends Error {
  override name = "ErrorApi";
  readonly tipo: TipoErrorApi;

  constructor(tipo: TipoErrorApi, causa?: unknown, mensaje?: string) {
    super(mensaje ?? MENSAJES[tipo], causa === undefined ? undefined : { cause: causa });
    this.tipo = tipo;
  }
}

/** El token del central no sale de acá: vive en la clausura de `crearApi` y nunca se expone a las vistas. */
export type Sesion = { personal: false } | { personal: true; persona: { id: string; nombre: string; equipo: string }; dir: string; repos: string[] };

const checkSesionPersonal = obj({ personal: lit(true), persona: obj({ id: slug, nombre: str, equipo: str }), dir: str, repos: arr(str), token: str });

const checkSesion: Check<{ personal: false } | Infer<typeof checkSesionPersonal>> = (v, r) => {
  const { personal } = objAbierto({ personal: bool })(v, r);
  if (!personal) return { personal: false };
  return checkSesionPersonal(v, r);
};

const checkRespuestaCambios = obj({ vistaPrevia: arr(str), aplicado: bool }, { aviso: str });
export type RespuestaCambios = Infer<typeof checkRespuestaCambios>;

const checkRespuestaChat = obj({ respuesta: str, cambios: checkCambios, vistaPrevia: arr(str) }, { aviso: str });
export type RespuestaChat = Infer<typeof checkRespuestaChat>;

const checkInfoChat = nullable(obj({ sessionId: str, retomar: str }));
/** La sesión de la conversación de esta semana, o `null` si todavía no hay. */
export type InfoChat = Infer<typeof checkInfoChat>;

const checkSinDaily = obj({ proximoDaily: nullable(str) });
/** Antes del primer `rastro daily` no hay snapshot: el central manda el plan de plan.md y la hora del daily automático, si hay uno. */
export type SinDaily = Infer<typeof checkSinDaily>;
const checkQueViene = obj({ semana: str, tareas: num });
/** Esta semana no tiene plan pero la que viene sí: cuántas tareas, para decirlo en vez de ofrecer armar un plan. */
export type PlanQueViene = Infer<typeof checkQueViene>;
const checkRespuestaConAnexos = obj({ snapshot: desconocido }, { sinDaily: checkSinDaily, queViene: checkQueViene });

/** `sinDaily` está solo cuando todavía no corrió ningún daily: el resto del snapshot es lo que se puede armar sin él. `queViene`, solo sin plan esta semana. */
export type PersonaCargada = Snapshot & { sinDaily?: SinDaily; queViene?: PlanQueViene };

export interface Api {
  cargarEquipo(): Promise<FilaEquipo[]>;
  cargarPersona(id: string): Promise<PersonaCargada>;
  cargarSesion(): Promise<Sesion>;
  enviarCambios(cambios: readonly Cambio[], confirmar: boolean): Promise<RespuestaCambios>;
  /** Puede tardar hasta 180 s: el central no ofrece cancelarlo. */
  enviarMensaje(mensaje: string): Promise<RespuestaChat>;
  cargarChat(): Promise<InfoChat>;
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

/** El texto que el central puso en el cuerpo de un error, o `undefined` para caer en el mensaje genérico. */
async function mensajeDelCentral(res: Response): Promise<string | undefined> {
  try {
    const { error } = objAbierto({ error: str })(await res.json(), "error");
    return error === "" ? undefined : error;
  } catch {
    // Sin cuerpo JSON con `error` (un proxy, un 5xx crudo) no hay mensaje propio: queda el genérico.
    return undefined;
  }
}

export function crearApi({ fuente = fuenteDeEntorno(), fetch: pedir = (...args) => fetch(...args) }: OpcionesApi = {}): Api {
  const rutaEquipo = fuente === "ejemplos" ? "./ejemplos/equipo.json" : "/api/equipo";
  const rutaPersona = (id: string): string =>
    fuente === "ejemplos" ? `./ejemplos/persona-${id}.json` : `/api/persona/${id}`;

  // Solo en memoria: ni la URL ni el almacenamiento del navegador.
  let token: string | null = null;

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
    if (!res.ok) throw new ErrorApi("central", new Error(`${ruta}: ${res.status}`), await mensajeDelCentral(res));
    try {
      return await res.json();
    } catch (causa) {
      throw new ErrorApi("contrato", causa);
    }
  }

  /** POST con el token de la sesión; el 403 es el mismo para cambios y chat: el central se reinició y el token ya no vale. */
  async function postear(ruta: string, cuerpo: unknown): Promise<{ res: Response; cuerpo: unknown }> {
    if (token === null) throw new ErrorApi("sin-sesion");
    let res: Response;
    try {
      res = await pedir(ruta, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Rastro-Token": token },
        body: JSON.stringify(cuerpo),
      });
    } catch (causa) {
      throw new ErrorApi("central", causa);
    }
    if (res.status === 403) throw new ErrorApi("reiniciado", new Error(`${ruta}: 403`));
    try {
      return { res, cuerpo: await res.json() };
    } catch (causa) {
      throw new ErrorApi(res.ok ? "contrato" : "central", causa);
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
        if (typeof crudo === "object" && crudo !== null && "snapshot" in crudo) {
          const { sinDaily, queViene, snapshot } = checkRespuestaConAnexos(crudo, "persona");
          return { ...validarSnapshot(snapshot), ...(sinDaily === undefined ? {} : { sinDaily }), ...(queViene === undefined ? {} : { queViene }) };
        }
        return validarSnapshot(crudo);
      } catch (causa) {
        throw new ErrorApi("contrato", causa);
      }
    },

    async cargarSesion() {
      if (fuente === "ejemplos") return { personal: false };
      const crudo = await pedirJson("/api/sesion", "central");
      try {
        const sesion = checkSesion(crudo, "sesion");
        if (!sesion.personal) return { personal: false };
        token = sesion.token;
        return { personal: true, persona: sesion.persona, dir: sesion.dir, repos: sesion.repos };
      } catch (causa) {
        throw new ErrorApi("contrato", causa);
      }
    },

    async enviarCambios(cambios, confirmar) {
      const { res, cuerpo } = await postear("/api/cambios", { cambios, confirmar });
      try {
        if (res.status === 400) throw new ErrorApi("rechazado", undefined, objAbierto({ error: str })(cuerpo, "error").error);
        if (!res.ok) throw new ErrorApi("central", new Error(`/api/cambios: ${res.status}`));
        return checkRespuestaCambios(cuerpo, "cambios");
      } catch (causa) {
        throw causa instanceof ErrorApi ? causa : new ErrorApi("contrato", causa);
      }
    },

    async enviarMensaje(mensaje) {
      const { res, cuerpo } = await postear("/api/chat", { mensaje });
      try {
        if (res.status === 409) throw new ErrorApi("en-curso", new Error("/api/chat: 409"));
        // 400 (mensaje inválido) y 502 (falló `claude`) traen el texto para la persona.
        if (res.status === 400 || res.status === 502) throw new ErrorApi("rechazado", undefined, objAbierto({ error: str })(cuerpo, "error").error);
        if (!res.ok) throw new ErrorApi("central", new Error(`/api/chat: ${res.status}`));
        return checkRespuestaChat(cuerpo, "chat");
      } catch (causa) {
        throw causa instanceof ErrorApi ? causa : new ErrorApi("contrato", causa);
      }
    },

    async cargarChat() {
      const crudo = await pedirJson("/api/chat", "central");
      try {
        return checkInfoChat(crudo, "chat");
      } catch (causa) {
        throw new ErrorApi("contrato", causa);
      }
    },
  };
}
