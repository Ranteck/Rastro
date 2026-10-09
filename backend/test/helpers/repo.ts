import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Entorno de git aislado de la config global de quien corre los tests. */
export const ENV_GIT: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

export type RepoTemporal = {
  dir: string;
  git: (...args: string[]) => string;
  escribir: (ruta: string, contenido: string) => void;
  commit: (mensaje: string, fechaIso?: string) => string;
};

export function crearRepo(): RepoTemporal {
  const dir = mkdtempSync(join(tmpdir(), "rastro-test-"));
  const git = (...args: string[]): string => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: ENV_GIT }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  git("config", "commit.gpgsign", "false");
  const escribir = (ruta: string, contenido: string): void => {
    const abs = join(dir, ruta);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contenido);
  };
  const commit = (mensaje: string, fechaIso?: string): string => {
    git("add", "-A");
    const env = fechaIso === undefined ? ENV_GIT : { ...ENV_GIT, GIT_AUTHOR_DATE: fechaIso, GIT_COMMITTER_DATE: fechaIso };
    execFileSync("git", ["commit", "-q", "--allow-empty", "-m", mensaje], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    return git("rev-parse", "HEAD");
  };
  return { dir, git, escribir, commit };
}
