import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { aplicarCambios, validarCambios } from "../cambios.ts";
import type { Cambio } from "../contract/cambios.ts";
import { Chat, ErrorChat, ErrorChatOcupado } from "../chat.ts";
import { MAX_MENSAJE } from "../contract/chat.ts";
import { leerConfig, rutasGlobales } from "../config.ts";
import { filaDe } from "../contract/equipo.ts";
import { validarSnapshot, type Snapshot } from "../contract/snapshot.ts";
import { bool, desconocido, ErrorValidacion, obj, str, type Check } from "../contract/validar.ts";
import { aplicarYRecalcular, reposObservados } from "../daily.ts";
import { ErrorUsuario } from "../errores.ts";
import { fechaLocal, lunesDe } from "../fechas.ts";
import type { Ejecutor } from "../llm/claudeCli.ts";
import { log } from "../log.ts";
import { redactarSnapshot } from "../publish.ts";
import { nombresRegistrados } from "../repos.ts";
import { horaOpcional, planQueViene, snapshotSinDaily } from "../sinDaily.ts";
import { leerState } from "../state.ts";
import type { Almacen } from "./almacen.ts";

const LIMITE_CUERPO = 1_000_000;
const TIPOS: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".txt": "text/plain; charset=utf-8",
};

/** Error del cliente: se responde con su estado y su mensaje, sin detalles internos. */
class ErrorPedido extends Error {
  override name = "ErrorPedido";
  readonly estado: number;

  constructor(estado: number, mensaje: string) {
    super(mensaje);
    this.estado = estado;
  }
}

/** Modo personal: el central muestra el plan global de la persona y solo lee y escribe en su carpeta global. */
type Personal = { ahora?: () => Date; ejecutar?: Ejecutor; binario?: string; horaDaily?: () => Promise<string | null> };
type Opciones = { almacen: Almacen; estaticos: string; personal?: Personal };

type Sesion = { dir: string; ahora: () => Date; horaDaily: () => Promise<string | null>; personaId: string; token: string; chat: Chat; puerto: () => number };

const checkCambiosPedido = obj({ cambios: desconocido, confirmar: bool });
const checkChatPedido = obj({ mensaje: str });

export function crearCentral(o: Opciones): Server {
  // Se valida la config al arrancar para fallar antes de atender, no en el primer pedido.
  const sesion: Sesion | null =
    o.personal === undefined
      ? null
      : {
          dir: rutasGlobales().dir,
          ahora: o.personal.ahora ?? (() => new Date()),
          horaDaily: o.personal.horaDaily ?? (() => Promise.resolve(null)),
          personaId: leerConfig().persona.id,
          token: randomBytes(32).toString("hex"),
          puerto: () => (servidor.address() as AddressInfo).port,
          chat: new Chat({ ...(o.personal.ejecutar === undefined ? {} : { ejecutar: o.personal.ejecutar }), ...(o.personal.binario === undefined ? {} : { binario: o.personal.binario }) }),
        };
  const servidor: Server = createServer((req, res) => {
    atender(req, res, o, sesion).catch((e: unknown) => {
      if (e instanceof ErrorPedido) {
        responderJson(res, e.estado, { error: e.message });
        return;
      }
      if (e instanceof ErrorChatOcupado) {
        responderJson(res, 409, { error: e.message });
        return;
      }
      if (e instanceof ErrorChat) {
        responderJson(res, 502, { error: e.message });
        return;
      }
      if (e instanceof ErrorUsuario) {
        responderJson(res, 400, { error: sinRutas(e.message) });
        return;
      }
      log("error", "central_fallo", { ruta: req.url ?? "", detalle: e instanceof Error ? e.message : String(e) });
      responderJson(res, 500, { error: "error interno del central" });
    });
  });
  return servidor;
}

async function atender(req: IncomingMessage, res: ServerResponse, o: Opciones, sesion: Sesion | null): Promise<void> {
  // Solo se atiende a quien llega por una dirección local: otro Host indica un ataque de DNS rebinding desde el navegador.
  if (!HOSTS_LOCALES.has(hostnameDe(req.headers.host))) throw new ErrorPedido(403, "host no permitido");
  const ruta = rutaDe(req.url ?? "/");
  if (req.method === "POST" && ruta === "/api/publish") {
    if (!/^application\/json\s*(?:;|$)/i.test(req.headers["content-type"] ?? "")) throw new ErrorPedido(415, "se esperaba content-type application/json");
    const snapshot = validarCuerpo(await leerCuerpo(req));
    o.almacen.guardar(snapshot);
    log("info", "snapshot_recibido", { persona: snapshot.persona.id, equipo: snapshot.persona.equipo });
    responderJson(res, 201, { ok: true });
    return;
  }
  if (req.method === "POST" && (ruta === "/api/cambios" || ruta === "/api/chat")) {
    if (sesion === null) throw new ErrorPedido(404, "ruta no encontrada");
    protegerPost(req, sesion);
    const cuerpo = parsearJson(await leerCuerpo(req));
    await (ruta === "/api/cambios" ? cambiar(res, sesion, cuerpo) : conversar(res, sesion, cuerpo));
    return;
  }
  if (req.method !== "GET") throw new ErrorPedido(405, "método no permitido");
  if (ruta === "/api/sesion") {
    responderJson(
      res,
      200,
      sesion === null ? { personal: false } : { personal: true, persona: leerConfig().persona, dir: sesion.dir, repos: nombresRegistrados(), token: sesion.token },
    );
    return;
  }
  if (ruta === "/api/chat") {
    if (sesion === null) throw new ErrorPedido(404, "ruta no encontrada");
    responderJson(res, 200, sesion.chat.sesion(lunesDe(hoyDe(sesion))));
    return;
  }
  if (ruta === "/api/equipo") {
    const local = sesion === null ? null : snapshotLocalOmitible(sesion);
    const filas = [...o.almacen.todos().filter((s) => s.persona.id !== local?.persona.id), ...(local === null ? [] : [local])]
      .map(filaDe)
      .sort((a, b) => Number(b.alerta) - Number(a.alerta) || a.persona.nombre.localeCompare(b.persona.nombre));
    responderJson(res, 200, { equipo: filas });
    return;
  }
  const persona = /^\/api\/persona\/([^/]+)$/.exec(ruta)?.[1];
  if (persona !== undefined) {
    const id = decodificar(persona);
    if (sesion !== null && id === sesion.personaId) {
      let local: Snapshot | null;
      try {
        local = snapshotLocal(sesion);
      } catch (e) {
        if (!(e instanceof ErrorUsuario)) throw e;
        log("warn", "state_invalido", { ruta: "persona" });
        throw new ErrorPedido(409, "El snapshot local no es válido: corré `rastro daily` (o decile a Claude «cerrá el día») para regenerarlo.");
      }
      if (local === null) {
        // Sin daily no es una persona inexistente: un 404 haría que el dashboard diga "No encontré a esa persona". Se responde 200 con la marca `sinDaily`, el plan de plan.md y la hora del próximo automático.
        const config = leerConfig();
        const ahora = sesion.ahora();
        const hoy = fechaLocal(ahora, config.zonaHoraria);
        const sinDaily = snapshotSinDaily({ config, hoy, ahora });
        const queViene = sinDaily.plan === null ? planQueViene(hoy) : null;
        responderJson(res, 200, { sinDaily: { proximoDaily: await horaOpcional(sesion.horaDaily) }, ...(queViene === null ? {} : { queViene }), snapshot: sinDaily });
        return;
      }
      // El snapshot sale tal cual; solo si no hay plan esta semana viaja aparte lo que haya de la que viene.
      const queViene = local.plan === null ? planQueViene(hoyDe(sesion)) : null;
      responderJson(res, 200, queViene === null ? local : { queViene, snapshot: local });
      return;
    }
    const s = o.almacen.leer(id);
    if (s === null) throw new ErrorPedido(404, "persona no encontrada");
    responderJson(res, 200, s);
    return;
  }
  if (ruta.startsWith("/api/")) throw new ErrorPedido(404, "ruta no encontrada");
  servirEstatico(res, o.estaticos, decodificar(ruta));
}

/** El dashboard muestra estos mensajes: del archivo con problemas alcanza el nombre, no la ruta de la máquina. */
function sinRutas(mensaje: string): string {
  return mensaje.replaceAll(/(?:[A-Za-z]:)?(?:[\\/][^\s\\/:()]+)+[\\/]([^\s\\/:()]+)/g, "$1");
}

const hoyDe = (sesion: Sesion): string => fechaLocal(sesion.ahora(), leerConfig().zonaHoraria);

/** Lo que `rastro daily` dejó en ~/.rastro/state.json, redactado como lo que se publica: verse a uno mismo no requiere publicar. */
function snapshotLocal(sesion: Sesion): Snapshot | null {
  return existsSync(rutasGlobales().state) ? redactarSnapshot(leerState()) : null;
}

/** En la lista del equipo un state.json roto no tumba a los demás: se omite la fila propia y queda el aviso en el log. */
function snapshotLocalOmitible(sesion: Sesion): Snapshot | null {
  try {
    return snapshotLocal(sesion);
  } catch (e) {
    if (!(e instanceof ErrorUsuario)) throw e;
    log("warn", "state_invalido", { ruta: "equipo" });
    return null;
  }
}

const igualesEnTiempoConstante = (a: string, b: string): boolean => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

/**
 * Un POST que modifica el proyecto no puede venir de cualquier página abierta en el navegador:
 * hace falta el token que solo entrega /api/sesion, un Origin propio (si viene) y JSON.
 */
function protegerPost(req: IncomingMessage, sesion: Sesion): void {
  const token = req.headers["x-rastro-token"];
  const origen = req.headers.origin;
  const puerto = sesion.puerto();
  const propios = [`http://127.0.0.1:${puerto}`, `http://localhost:${puerto}`];
  const jsonValido = /^application\/json\s*(?:;|$)/i.test(req.headers["content-type"] ?? "");
  if (typeof token !== "string" || !igualesEnTiempoConstante(token, sesion.token) || (origen !== undefined && !propios.includes(origen)) || !jsonValido) {
    throw new ErrorPedido(403, "no autorizado");
  }
}

function entrada<T>(check: Check<T>, crudo: unknown): T {
  try {
    return check(crudo, "pedido");
  } catch (e) {
    if (e instanceof ErrorValidacion) throw new ErrorPedido(400, e.message);
    throw e;
  }
}

async function cambiar(res: ServerResponse, sesion: Sesion, cuerpo: unknown): Promise<void> {
  const pedido = entrada(checkCambiosPedido, cuerpo);
  const config = leerConfig();
  const hoy = fechaLocal(sesion.ahora(), config.zonaHoraria);
  responderJson(res, 200, aplicarYRecalcular({ repos: reposObservados().map((r) => r.ruta), config, cambios: validarCambios(pedido.cambios), destino: "vigente", confirmar: pedido.confirmar, hoy }));
}

async function conversar(res: ServerResponse, sesion: Sesion, cuerpo: unknown): Promise<void> {
  const { mensaje } = entrada(checkChatPedido, cuerpo);
  if (mensaje.trim() === "" || mensaje.length > MAX_MENSAJE) throw new ErrorPedido(400, `el mensaje tiene que tener entre 1 y ${MAX_MENSAJE} caracteres`);
  const config = leerConfig();
  const hoy = fechaLocal(sesion.ahora(), config.zonaHoraria);
  // Antes del LLM: sin repos registrados no se gasta una llamada.
  const repos = reposObservados().map((r) => r.ruta);
  const archivoPlan = rutasGlobales().plan;
  const propuesto = await sesion.chat.enviar({
    mensaje,
    plan: existsSync(archivoPlan) ? readFileSync(archivoPlan, "utf8") : "",
    snapshot: existsSync(rutasGlobales().state) ? leerState() : null,
    config,
    hoy,
    semana: lunesDe(hoy),
  });
  // El chat solo propone: acá se arma la vista previa y aplicar es un POST /api/cambios aparte.
  // Los repos se resuelven una sola vez: sin repos el error le llega a la persona en vez de pasar por "cambio no aplicable", y el aviso de repos caídos no se repite por cambio.
  const aplicables = propuesto.cambios.filter((p) => vistaPreviaDe(repos, config, hoy, [p.cambio], p.posicion) !== null).map((p) => p.cambio);
  const vistaPrevia = aplicables.length === 0 ? null : vistaPreviaDe(repos, config, hoy, aplicables);
  responderJson(res, 200, {
    respuesta: propuesto.respuesta,
    cambios: vistaPrevia === null ? [] : aplicables,
    vistaPrevia: vistaPrevia ?? [],
    ...(propuesto.aviso === undefined ? {} : { aviso: propuesto.aviso }),
  });
}

function vistaPreviaDe(repos: readonly string[], config: ReturnType<typeof leerConfig>, hoy: string, cambios: readonly Cambio[], posicion?: number): string[] | null {
  try {
    return aplicarCambios({ repos, config, cambios, destino: "vigente", confirmar: false, hoy }).vistaPrevia;
  } catch (e) {
    if (!(e instanceof ErrorUsuario)) throw e;
    // Un cambio que no se podría aplicar (tarea inexistente, día fuera de la semana) no se ofrece.
    log("warn", "chat_cambio_descartado", { tipo: e.name, ...(posicion === undefined ? {} : { posicion }) });
    return null;
  }
}

const HOSTS_LOCALES: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]"]);

function hostnameDe(host: string | undefined): string {
  try {
    return new URL(`http://${host ?? ""}`).hostname;
  } catch {
    return "";
  }
}

function rutaDe(url: string): string {
  try {
    return new URL(url, "http://central").pathname;
  } catch {
    throw new ErrorPedido(400, "ruta inválida");
  }
}

function decodificar(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    throw new ErrorPedido(400, "ruta mal codificada");
  }
}

function parsearJson(cuerpo: string): unknown {
  try {
    return JSON.parse(cuerpo);
  } catch {
    throw new ErrorPedido(400, "el cuerpo no es JSON válido");
  }
}

function validarCuerpo(cuerpo: string): Snapshot {
  try {
    return validarSnapshot(parsearJson(cuerpo));
  } catch (e) {
    if (e instanceof ErrorValidacion) throw new ErrorPedido(400, e.message);
    throw e;
  }
}

function leerCuerpo(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    let total = 0;
    req.on("data", (parte: Buffer) => {
      total += parte.length;
      if (total <= LIMITE_CUERPO) partes.push(parte);
    });
    // Se drena el cuerpo entero antes de responder 413 para que el cliente reciba la respuesta.
    req.on("end", () =>
      total > LIMITE_CUERPO ? reject(new ErrorPedido(413, "el pedido supera 1 MB")) : resolve(Buffer.concat(partes).toString("utf8")),
    );
    req.on("error", reject);
  });
}

function servirEstatico(res: ServerResponse, raiz: string, ruta: string): void {
  const base = resolve(raiz);
  if (!existsSync(base)) {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("Central de Rastro: la UI todavía no está construida (el pedido está en frontend/README.md). La API está en /api/equipo.\n");
    return;
  }
  let archivo = resolve(base, `.${ruta}`);
  if (archivo !== base && !archivo.startsWith(base + sep)) throw new ErrorPedido(404, "no encontrado");
  // Las rutas sin extensión van a index.html para que la UI pueda tener su propio ruteo.
  if (archivo === base || extname(archivo) === "") archivo = join(base, "index.html");
  if (!existsSync(archivo) || !statSync(archivo).isFile()) throw new ErrorPedido(404, "no encontrado");
  // Un enlace simbólico dentro de dist no puede sacar archivos de afuera: se compara la ruta real.
  const real = realpathSync(archivo);
  const baseReal = realpathSync(base);
  if (!real.startsWith(baseReal + sep)) throw new ErrorPedido(404, "no encontrado");
  res.writeHead(200, { "content-type": TIPOS[extname(archivo)] ?? "application/octet-stream" });
  res.end(readFileSync(real));
}

function responderJson(res: ServerResponse, estado: number, cuerpo: unknown): void {
  res.writeHead(estado, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(cuerpo));
}
