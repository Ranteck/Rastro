import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { validarCambios } from "./cambios.ts";
import type { Cambio } from "./contract/cambios.ts";
import { rutasGlobales, type Config } from "./config.ts";
import type { Snapshot } from "./contract/snapshot.ts";
import { arr, bool, desconocido, ErrorValidacion, fecha, nullable, obj, objAbierto, str, uuid } from "./contract/validar.ts";
import { tareasAtrasadas } from "./detectores/desvios.ts";
import { ErrorUsuario } from "./errores.ts";
import type { Fecha } from "./fechas.ts";
import { ejecutarProceso, type Ejecutor } from "./llm/claudeCli.ts";
import { log } from "./log.ts";
import { listar } from "./repos.ts";
import { parsearPlan } from "./plan.ts";
import { redactar } from "./redactar.ts";
import { comillas } from "./texto.ts";

const TIMEOUT_MS = 180_000;
const ULTIMAS_ENTRADAS = 10;

/** Otro mensaje todavía está en curso: la sesión de claude no admite dos turnos a la vez. */
export class ErrorChatOcupado extends ErrorUsuario {
  override name = "ErrorChatOcupado";
}

/** Falla de claude (no instalado, timeout, salida inválida): el mensaje es para el usuario y el detalle va al log. */
export class ErrorChat extends Error {
  override name = "ErrorChat";
}

// `historial` tiene todas las sesiones de chat que se abrieron alguna vez (la actual incluida): se anotan antes de correr
// porque claude deja el transcript aunque la llamada falle, y esos transcripts no son trabajo de la persona.
const checkEstado = obj({ semana: fecha, sessionId: nullable(uuid) }, { historial: arr(uuid) });
type Estado = { semana: Fecha; sessionId: string | null; historial: string[] };
const checkSalida = objAbierto({ is_error: bool }, { structured_output: desconocido });
const checkRespuesta = obj({ respuesta: str, cambios: arr(desconocido) });

// `repo` puede ser un nombre registrado o null (sacarle el repo a la tarea): el modelo no puede inventar un nombre.
const esquema = (nombres: readonly string[]): object => ({
  type: "object",
  properties: {
    respuesta: { type: "string" },
    cambios: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tipo: { enum: ["duracion", "dia", "estado", "repo", "vinculo", "ofrecimiento"] },
          tarea: { type: ["string", "null"] },
          duracion: { type: ["object", "null"], properties: { valor: { type: "number" }, unidad: { enum: ["h", "d"] } } },
          dias: { type: "array", items: { type: "string" } },
          estado: { enum: ["pendiente", "hecha", "sacada"] },
          repo: { enum: [...nombres, null] },
          commit: { type: "string" },
          id: { type: "string" },
          accion: { enum: ["aceptar", "descartar"] },
        },
        required: ["tipo"],
      },
    },
  },
  required: ["respuesta", "cambios"],
});

// Va en el system prompt solo lo que no cambia: claude lo graba en el primer turno y lo reusa al retomar la sesión.
const sistema = (nombres: readonly string[]): string =>
  [
    "Sos el asistente de Rastro, una herramienta que acompaña el plan semanal, los tiempos y los desvíos de una persona sobre sus proyectos.",
    "Respondé en castellano rioplatense, breve y concreto. Cada mensaje trae la fecha de hoy, el plan vigente y un resumen: usá siempre los del mensaje más reciente.",
    "La conversación sigue en la misma sesión durante toda la semana del plan: te acordás de los mensajes anteriores y podés apoyarte en ellos.",
    "No tenés herramientas ni acceso a archivos: trabajás con lo que el mensaje trae. Vos NO modificás nada: cuando convenga cambiar el plan, proponelo en `cambios` y la persona lo confirma aparte.",
    "Los cambios posibles son: {tipo:'duracion', tarea, duracion:{valor,unidad:'h'|'d'}|null}, {tipo:'dia', tarea, dias:['AAAA-MM-DD'...]},",
    `{tipo:'estado', tarea, estado:'pendiente'|'hecha'|'sacada'}, {tipo:'repo', tarea, repo:${nombres.length === 0 ? "" : `${nombres.map((n) => `'${n}'`).join("|")}|`}null} (a qué repo pertenece la tarea; null la deja sin repo),`,
    "{tipo:'vinculo', commit (SHA), tarea|null} y {tipo:'ofrecimiento', id, accion:'aceptar'|'descartar'}.",
    "`tarea` es el slug de la tarea del plan. Si no hay nada para proponer, devolvé `cambios` vacío.",
  ].join("\n");

// Foco y bitácora son del último daily y lo dicen; las atrasadas se calculan en fresco con el plan y la fecha de hoy, como `siguiente`.
function resumen(s: Snapshot | null, plan: string, hoy: Fecha): string {
  const vigente = plan === "" ? null : parsearPlan(plan, hoy);
  const atrasadas = vigente === null ? [] : tareasAtrasadas(vigente, hoy);
  const lineaAtrasadas = `Atrasadas hoy: ${atrasadas.length === 0 ? "ninguna" : atrasadas.map((t) => t.nombre).join(", ")}.`;
  if (s === null) return [lineaAtrasadas, "Todavía no hay un `rastro daily`: no hay resumen de actividad."].join("\n");
  const nombre = (slug: string | null): string => (slug === null ? "ninguna" : (s.plan?.tareas.find((t) => t.slug === slug)?.nombre ?? slug));
  return [
    lineaAtrasadas,
    `Al ${s.periodo.hasta}, en el último daily:`,
    `Foco: actual ${nombre(s.foco?.actual ?? null)}, siguiente ${nombre(s.foco?.siguiente ?? null)}.`,
    `Fuera del plan: ${s.desvios.fueraDelPlanPct}%.`,
    "Últimas entradas de la bitácora:",
    ...s.bitacora.slice(0, ULTIMAS_ENTRADAS).map((e) => `- ${e.fecha} ${e.hora} [${e.tarea ?? "sin tarea"}] ${e.texto}`),
  ].join("\n");
}

function leerEstado(): Estado | null {
  const archivo = rutasGlobales().chat;
  if (!existsSync(archivo)) return null;
  try {
    const e = checkEstado(JSON.parse(readFileSync(archivo, "utf8")), "chat.json");
    return { semana: e.semana, sessionId: e.sessionId, historial: e.historial ?? (e.sessionId === null ? [] : [e.sessionId]) };
  } catch (e) {
    if (e instanceof ErrorValidacion || e instanceof SyntaxError) throw new ErrorUsuario(`${archivo} no es válido (${e.message}): borralo para empezar una conversación nueva.`, { cause: e });
    throw e;
  }
}

function guardarEstado(estado: Estado): void {
  mkdirSync(rutasGlobales().dir, { recursive: true });
  // Con archivo temporal: una lectura simultánea (el daily, un hook) nunca ve un chat.json a medio escribir.
  const temporal = `${rutasGlobales().chat}.tmp`;
  writeFileSync(temporal, `${JSON.stringify(estado, null, 2)}\n`);
  renameSync(temporal, rutasGlobales().chat);
}

/** Las sesiones de claude que abrió el chat de Rastro: las fuentes de Claude Code y el hook de sesión las ignoran. */
export function idsDeChat(avisos?: string[]): ReadonlySet<string> {
  try {
    return new Set(leerEstado()?.historial ?? []);
  } catch (e) {
    if (!(e instanceof ErrorUsuario)) throw e;
    // Un chat.json roto no puede frenar el daily ni el hook de sesión: se sigue sin excluir nada y se avisa.
    const aviso = `No se pudo leer ${rutasGlobales().chat}: las conversaciones del chat pueden aparecer como trabajo hasta que se arregle el archivo.`;
    if (avisos === undefined) log("warn", "chat_ilegible", {});
    else avisos.push(aviso);
    return new Set();
  }
}

/** claude terminó con código distinto de cero; `sesionPerdida` es el mensaje exacto de `--resume` sobre una sesión que no existe. */
class FalloDeProceso extends Error {
  override name = "FalloDeProceso";
  readonly sesionPerdida: boolean;

  constructor(codigo: number | null, stderr: string) {
    super(String(codigo));
    this.sesionPerdida = stderr.includes("No conversation found");
  }
}

type Turno = { mensaje: string; plan: string; snapshot: Snapshot | null; config: Config; hoy: Fecha; semana: Fecha };
/** `posicion` es el lugar del cambio en la lista que devolvió el modelo, para que los logs de los descartados hablen del mismo índice. */
type Respuesta = { respuesta: string; cambios: { cambio: Cambio; posicion: number }[]; aviso?: string };

// Las rutas comunes quedan sin comillas para que el comando se lea bien; el resto se cita para que el shell no las interprete.
const citar = (ruta: string): string => (/^[\w@%+=:,./-]+$/.test(ruta) ? ruta : comillas(ruta));

/** Un mensaje a la vez sobre una sesión de `claude -p` por semana, que corre en la carpeta global para poder retomarla en la terminal. */
export class Chat {
  readonly #ejecutar: Ejecutor;
  readonly #binario: string;
  #ocupado = false;

  constructor(o: { ejecutar?: Ejecutor; binario?: string } = {}) {
    this.#ejecutar = o.ejecutar ?? ejecutarProceso;
    this.#binario = o.binario ?? "claude";
  }

  sesion(semana: Fecha): { sessionId: string; retomar: string } | null {
    const estado = leerEstado();
    // Una semana nueva arranca una conversación nueva: el plan anterior ya no es el vigente.
    return estado === null || estado.semana !== semana || estado.sessionId === null
      ? null
      : { sessionId: estado.sessionId, retomar: `cd ${citar(rutasGlobales().dir)} && claude --resume ${estado.sessionId}` };
  }

  async enviar(o: Turno): Promise<Respuesta> {
    if (this.#ocupado) throw new ErrorChatOcupado("Todavía estoy respondiendo el mensaje anterior: esperá un momento.");
    this.#ocupado = true;
    try {
      return await this.#turno(o);
    } finally {
      this.#ocupado = false;
    }
  }

  async #turno(o: Turno): Promise<Respuesta> {
    const entrada = redactar(
      [`Hoy es ${o.hoy}; la semana del plan empieza el ${o.semana}.`, `Plan vigente:\n${o.plan === "" ? "(sin plan)" : o.plan}`, resumen(o.snapshot, o.plan, o.hoy), `Mensaje:\n${o.mensaje}`].join("\n\n"),
    );
    const previa = this.sesion(o.semana);
    let salida: { respuesta: string; cambios: unknown[] };
    let aviso: string | undefined;
    if (previa === null) {
      salida = await this.#abrirSesion(o, entrada);
    } else {
      try {
        salida = await this.#correr(o.config, ["--resume", previa.sessionId], entrada);
      } catch (e) {
        // Solo "la sesión no existe" justifica empezar de nuevo; cualquier otra falla (sin sesión iniciada, cuota) es un error y no se reintenta.
        if (!(e instanceof FalloDeProceso) || !e.sesionPerdida) throw this.#falla(e);
        log("warn", "chat_sesion_perdida", { codigo: e.message });
        // La vieja queda en el historial y sin sesión vigente: si la nueva también falla, el próximo mensaje no vuelve a intentar el --resume.
        const estado = leerEstado();
        guardarEstado({ semana: o.semana, sessionId: null, historial: estado?.historial ?? [previa.sessionId] });
        aviso = "No encontré la conversación anterior: empecé una nueva.";
        salida = await this.#abrirSesion(o, entrada);
      }
    }
    const cambios = salida.cambios.flatMap((c, posicion): Respuesta["cambios"] => {
      try {
        return validarCambios([c]).map((cambio) => ({ cambio, posicion }));
      } catch (e) {
        // El chat puede inventar cambios mal formados: se descartan en vez de frenar la respuesta.
        if (!(e instanceof ErrorUsuario)) throw e;
        // El mensaje del validador cita lo que dijo el modelo: al log van solo el tipo y la posición.
        log("warn", "chat_cambio_descartado", { tipo: e.name, posicion });
        return [];
      }
    });
    return aviso === undefined ? { respuesta: salida.respuesta, cambios } : { respuesta: salida.respuesta, cambios, aviso };
  }

  async #abrirSesion(o: Turno, entrada: string): Promise<{ respuesta: string; cambios: unknown[] }> {
    const sessionId = randomUUID();
    const estado = leerEstado();
    // Se anota antes de correr: aunque la llamada falle, claude puede haber dejado el transcript.
    guardarEstado({ semana: estado?.semana ?? o.semana, sessionId: estado?.sessionId ?? null, historial: [...(estado?.historial ?? []), sessionId] });
    let salida: { respuesta: string; cambios: unknown[] };
    try {
      salida = await this.#correr(o.config, ["--session-id", sessionId], entrada);
    } catch (e) {
      throw this.#falla(e);
    }
    guardarEstado({ semana: o.semana, sessionId, historial: [...(leerEstado()?.historial ?? [sessionId])] });
    return salida;
  }

  #falla(e: unknown): ErrorChat {
    // El texto de claude puede traer datos de la persona: al log va solo el tipo de error.
    log("error", "chat_fallo", { tipo: e instanceof Error ? e.name : "desconocido", ...(e instanceof FalloDeProceso ? { codigo: e.message } : {}) });
    const noEstaInstalado = (e as NodeJS.ErrnoException).code === "ENOENT";
    return new ErrorChat(noEstaInstalado ? "No encontré `claude` en el PATH: instalá Claude Code para usar el chat." : "El chat no pudo responder ahora: probá de nuevo en un rato.", { cause: e });
  }

  async #correr(config: Config, sesion: readonly string[], entrada: string): Promise<{ respuesta: string; cambios: unknown[] }> {
    const nombres = listar().map((r) => r.nombre);
    const args = [
      "-p",
      "--output-format", "json",
      "--model", config.chat?.modelo ?? "sonnet",
      ...sesion,
      // Sin herramientas: Read/Grep/Glob no se pueden acotar de forma confiable al proyecto (las reglas de denegación son "best effort" para Grep y Glob).
      "--tools", "",
      "--permission-mode", "dontAsk",
      // Los hooks (del proyecto, del usuario o de plugins) registrarían cada mensaje del chat como trabajo: se cierran por tres lados.
      "--restricted",
      "--settings", '{"disableAllHooks":true}',
      "--strict-mcp-config",
      "--append-system-prompt", sistema(nombres),
      "--json-schema", JSON.stringify(esquema(nombres)),
    ];
    const r = await this.#ejecutar(this.#binario, args, entrada, TIMEOUT_MS, rutasGlobales().dir);
    if (r.codigo !== 0) throw new FalloDeProceso(r.codigo, r.stderr);
    const salida = checkSalida(JSON.parse(r.stdout), "claude");
    if (salida.is_error || salida.structured_output === undefined) throw new Error("claude respondió sin salida estructurada");
    return checkRespuesta(salida.structured_output, "chat");
  }
}
