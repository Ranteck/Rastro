import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import { rutasGlobales } from "./config.ts";
import { nombreDeRepoValido } from "./contract/cambios.ts";
import { arr, ErrorValidacion, obj, str, type Check } from "./contract/validar.ts";
import { ErrorUsuario } from "./errores.ts";
import { log } from "./log.ts";

const rutaAbsoluta: Check<string> = (v, r) => {
  const ruta = str(v, r);
  if (ruta === "" || !isAbsolute(ruta)) throw new ErrorValidacion(r, "se esperaba una ruta absoluta");
  return ruta;
};

const nombreNoVacio: Check<string> = (v, r) => {
  const nombre = str(v, r);
  if (nombre === "") throw new ErrorValidacion(r, "se esperaba un nombre no vacío");
  return nombre;
};

const sinRepetidos: Check<RepoObservado[]> = (v, r) => {
  const repos = arr(obj({ ruta: rutaAbsoluta, nombre: nombreNoVacio }))(v, r);
  for (const campo of ["ruta", "nombre"] as const) {
    const vistos = new Set<string>();
    for (const [i, repo] of repos.entries()) {
      if (vistos.has(repo[campo])) throw new ErrorValidacion(`${r}[${i}].${campo}`, `repetido: ${repo[campo]}`);
      vistos.add(repo[campo]);
    }
  }
  return repos;
};

const checkRepos = obj({ repos: sinRepetidos });

export type RepoObservado = { ruta: string; nombre: string };

function leerTodos(): RepoObservado[] {
  const archivo = rutasGlobales().repos;
  if (!existsSync(archivo)) return [];
  try {
    return checkRepos(JSON.parse(readFileSync(archivo, "utf8")), "repos").repos;
  } catch (e) {
    if (e instanceof ErrorValidacion || e instanceof SyntaxError) {
      throw new ErrorUsuario(`${archivo} no es válido (${e.message}): corregilo o borralo y volvé a correr \`rastro init\` en cada repo.`, { cause: e });
    }
    throw e;
  }
}

function guardar(repos: readonly RepoObservado[]): void {
  const { dir, repos: archivo } = rutasGlobales();
  mkdirSync(dir, { recursive: true });
  // Con archivo temporal: una lectura simultánea (un hook) nunca ve un repos.json a medio escribir.
  const temporal = `${archivo}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporal, `${JSON.stringify({ repos }, null, 2)}\n`);
    renameSync(temporal, archivo);
  } catch (e) {
    rmSync(temporal, { force: true });
    throw e;
  }
}

/** Suma el repo (la raíz git, ruta absoluta) y devuelve su nombre corto; si ya estaba, no cambia nada. */
export function registrar(ruta: string): RepoObservado {
  const todos = leerTodos();
  const existente = todos.find((r) => r.ruta === ruta);
  if (existente !== undefined) return existente;
  const base = nombreDeRepoValido(basename(ruta));
  const usados = new Set(todos.map((r) => r.nombre));
  let nombre = base;
  for (let n = 2; usados.has(nombre); n++) nombre = `${base}-${n}`;
  const nuevo = { ruta, nombre };
  guardar([...todos, nuevo]);
  return nuevo;
}

/** Los repos observados que siguen en el disco; los que ya no existen se saltean con un aviso. */
export function listar(): RepoObservado[] {
  return leerTodos().filter((r) => {
    if (existsSync(r.ruta)) return true;
    log("warn", "repo-inexistente", { ruta: r.ruta, nombre: r.nombre });
    return false;
  });
}

/** Consulta el registro tal cual está, sin el filtro de existencia en disco de `listar`: un repo movido sigue registrado. */
export function nombreRegistrado(nombre: string): boolean {
  return leerTodos().some((r) => r.nombre === nombre);
}

/** Los nombres cortos de todos los repos registrados, con o sin su carpeta en el disco; el dashboard los ofrece al asignar el repo de una tarea. */
export function nombresRegistrados(): string[] {
  return leerTodos().map((r) => r.nombre);
}

/** El nombre corto con el que está registrado el repo de esa ruta, o null si no lo está. */
export function nombreDeRepo(ruta: string): string | null {
  return leerTodos().find((r) => r.ruta === ruta)?.nombre ?? null;
}

export function estaRegistrado(ruta: string): boolean {
  return nombreDeRepo(ruta) !== null;
}

export function quitar(ruta: string): boolean {
  const todos = leerTodos();
  const quedan = todos.filter((r) => r.ruta !== ruta);
  if (quedan.length === todos.length) return false;
  guardar(quedan);
  return true;
}

/** Devuelve el nombre corto del repo; si no está observado, corta con un error para el usuario. */
export function exigirRegistrado(ruta: string): string {
  const nombre = nombreDeRepo(ruta);
  if (nombre === null) throw new ErrorUsuario("Este repo no está observado por Rastro: corré `rastro init` en él.");
  return nombre;
}
