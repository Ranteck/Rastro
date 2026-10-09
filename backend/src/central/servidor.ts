import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { filaDe } from "../contract/equipo.ts";
import { validarSnapshot, type Snapshot } from "../contract/snapshot.ts";
import { ErrorValidacion } from "../contract/validar.ts";
import { log } from "../log.ts";
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

type Opciones = { almacen: Almacen; estaticos: string };

export function crearCentral(o: Opciones): Server {
  return createServer((req, res) => {
    atender(req, res, o).catch((e: unknown) => {
      if (e instanceof ErrorPedido) {
        responderJson(res, e.estado, { error: e.message });
        return;
      }
      log("error", "central_fallo", { ruta: req.url ?? "", detalle: e instanceof Error ? e.message : String(e) });
      responderJson(res, 500, { error: "error interno del central" });
    });
  });
}

async function atender(req: IncomingMessage, res: ServerResponse, o: Opciones): Promise<void> {
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
  if (req.method !== "GET") throw new ErrorPedido(405, "método no permitido");
  if (ruta === "/api/equipo") {
    const filas = o.almacen
      .todos()
      .map(filaDe)
      .sort((a, b) => Number(b.alerta) - Number(a.alerta) || a.persona.nombre.localeCompare(b.persona.nombre));
    responderJson(res, 200, { equipo: filas });
    return;
  }
  const persona = /^\/api\/persona\/([^/]+)$/.exec(ruta)?.[1];
  if (persona !== undefined) {
    const s = o.almacen.leer(decodificar(persona));
    if (s === null) throw new ErrorPedido(404, "persona no encontrada");
    responderJson(res, 200, s);
    return;
  }
  if (ruta.startsWith("/api/")) throw new ErrorPedido(404, "ruta no encontrada");
  servirEstatico(res, o.estaticos, decodificar(ruta));
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

function validarCuerpo(cuerpo: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(cuerpo);
  } catch {
    throw new ErrorPedido(400, "el cuerpo no es JSON válido");
  }
  try {
    return validarSnapshot(raw);
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
      total > LIMITE_CUERPO ? reject(new ErrorPedido(413, "el snapshot supera 1 MB")) : resolve(Buffer.concat(partes).toString("utf8")),
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
