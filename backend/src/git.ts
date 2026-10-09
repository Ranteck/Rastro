import { execFileSync } from "node:child_process";
import { ErrorUsuario } from "./errores.ts";

export type Commit = { sha: string; fecha: Date; padres: string[]; asunto: string; cuerpo: string; archivos: string[]; rama: string };
export type Rama = { nombre: string; ultimoCommit: Date; sha: string; mergeada: boolean };
export type DatosGit = { ramaPrincipal: string; commits: Commit[]; ramas: Rama[]; urlBase: string | null };

export function git(repo: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

export function raizDelRepo(dir: string): string {
  try {
    return git(dir, ["rev-parse", "--show-toplevel"]).trim();
  } catch (e) {
    throw new ErrorUsuario(`${dir} no está dentro de un repo git.`, { cause: e });
  }
}

function lineas(s: string): string[] {
  return s.split("\n").map((l) => l.trim()).filter((l) => l !== "");
}

export function ramaPrincipal(repo: string): string {
  try {
    return git(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).trim().replace(/^origin\//, "");
  } catch {
    // Sin origin/HEAD (repo sin remoto o sin fetch): se decide con las ramas locales.
  }
  const locales = lineas(git(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]));
  for (const candidata of ["main", "master"]) if (locales.includes(candidata)) return candidata;
  try {
    return git(repo, ["symbolic-ref", "--short", "HEAD"]).trim();
  } catch {
    return "HEAD"; // HEAD separado: no hay una rama actual para tomar como principal.
  }
}

export function urlBaseDe(remoto: string): string | null {
  const ssh = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(remoto);
  if (ssh !== null) return `https://${ssh[1]}/${ssh[2]}`;
  // El grupo opcional descarta "usuario:token@" para que las credenciales nunca lleguen a la evidencia.
  const https = /^https?:\/\/(?:[^@/]+@)?(.+?)(?:\.git)?\/?$/.exec(remoto);
  return https === null ? null : `https://${https[1]}`;
}

function urlRemota(repo: string): string | null {
  try {
    return git(repo, ["remote", "get-url", "origin"]).trim();
  } catch {
    return null; // Sin remoto origin: la evidencia va sin URL.
  }
}

/** Commits alcanzables desde `ref` desde `desdeGit` (cualquier fecha que acepte --since). Con `soloPrimerPadre` sigue solo la línea principal de los merges. */
export function commitsDe(repo: string, ref: string, desdeGit: string, soloPrimerPadre = false): Omit<Commit, "rama">[] {
  const opciones = soloPrimerPadre ? ["--first-parent"] : [];
  const salida = git(repo, ["log", ref, ...opciones, `--since=${desdeGit}`, "--name-only", "--format=%x1e%H%x1f%aI%x1f%P%x1f%s%x1f%b%x1d"]);
  return salida
    .split("\x1e")
    .filter((registro) => registro.trim() !== "")
    .map((registro) => {
      const [encabezado = "", archivos = ""] = registro.split("\x1d");
      const [sha = "", fecha = "", padres = "", asunto = "", cuerpo = ""] = encabezado.split("\x1f");
      return {
        sha,
        fecha: new Date(fecha),
        padres: padres.split(" ").filter((p) => p !== ""),
        asunto,
        cuerpo: cuerpo.trim(),
        archivos: lineas(archivos),
      };
    });
}

export function recolectarGit(repo: string, desdeGit: string): DatosGit {
  const principal = ramaPrincipal(repo);
  const ramasCrudas = lineas(git(repo, ["for-each-ref", "--format=%(refname:short)%09%(committerdate:iso-strict)%09%(objectname)", "refs/heads"])).map(
    (linea) => {
      const [nombre = "", fecha = "", sha = ""] = linea.split("\t");
      return { nombre, ultimoCommit: new Date(fecha), sha };
    },
  );
  const existePrincipal = ramasCrudas.some((r) => r.nombre === principal);
  const mergeadas = existePrincipal ? new Set(lineas(git(repo, ["branch", "--merged", principal, "--format=%(refname:short)"]))) : new Set<string>();
  // Una rama vacía o avanzada por fast-forward tiene la punta en la línea principal: está en --merged pero no se mergeó con un merge commit.
  const enLineaPrincipal = existePrincipal ? new Set(lineas(git(repo, ["rev-list", "--first-parent", principal]))) : new Set<string>();
  const ramas: Rama[] = ramasCrudas.map((r) => ({ ...r, mergeada: r.nombre !== principal && mergeadas.has(r.nombre) && !enLineaPrincipal.has(r.sha) }));

  const porSha = new Map<string, Commit>();
  const asignar = (nombre: string, soloPrimerPadre: boolean): void => {
    for (const c of commitsDe(repo, nombre, desdeGit, soloPrimerPadre)) if (!porSha.has(c.sha)) porSha.set(c.sha, { ...c, rama: nombre });
  };
  // La línea principal va primero: los commits hechos en ella antes de que naciera una rama de feature son de la principal.
  // Los de una rama mergeada quedan fuera del primer-padre y se asignan a su rama de feature.
  if (existePrincipal) asignar(principal, true);
  for (const r of ramas) if (r.nombre !== principal) asignar(r.nombre, false);
  if (existePrincipal) asignar(principal, false);
  const url = urlRemota(repo);
  return {
    ramaPrincipal: principal,
    commits: [...porSha.values()].sort((a, b) => b.fecha.getTime() - a.fecha.getTime()),
    ramas,
    urlBase: url === null ? null : urlBaseDe(url),
  };
}

export function lineasAgregadas(repo: string, sha: string): string[] {
  return git(repo, ["show", "--format=", "--unified=0", "--no-color", sha])
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));
}

export function diffResumido(repo: string, sha: string, maxBytes: number): string {
  const d = git(repo, ["show", "--format=", "--stat", "--patch", "--unified=1", "--no-color", sha]);
  return d.length > maxBytes ? `${d.slice(0, maxBytes)}\n[diff truncado]` : d;
}
