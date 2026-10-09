import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { configPorDefecto, escribirConfig, rutas } from "./config.ts";
import { ErrorUsuario } from "./errores.ts";
import { git, raizDelRepo } from "./git.ts";
import { slugDe } from "./texto.ts";

const MARCA = "# rastro";
export const BIN_RASTRO = fileURLToPath(new URL("../bin/rastro.js", import.meta.url));

export function inicializar(repo: string, o: { equipo: string; binRastro: string }): string[] {
  const hechos: string[] = [];
  if (!existsSync(rutas(repo).config)) {
    const nombre = nombreDeGit(repo);
    escribirConfig(repo, configPorDefecto({ id: slugDe(nombre) || "yo", nombre, equipo: o.equipo }));
    hechos.push("Se creó .rastro/config.json");
  }
  hechos.push(excluir(repo, [".rastro/", ".claude/settings.local.json"]));
  hechos.push(instalarPostCommit(repo, o.binRastro));
  hechos.push(instalarSessionEnd(repo, o.binRastro));
  return hechos;
}

function nombreDeGit(repo: string): string {
  const pedido = 'Configurá tu nombre con `git config user.name "Tu Nombre"` y volvé a correr `rastro init`.';
  let nombre: string;
  try {
    nombre = git(repo, ["config", "user.name"]).trim();
  } catch (e) {
    throw new ErrorUsuario(pedido, { cause: e });
  }
  if (nombre === "") throw new ErrorUsuario(pedido);
  return nombre;
}

function excluir(repo: string, patrones: readonly string[]): string {
  const archivo = resolve(repo, git(repo, ["rev-parse", "--git-path", "info/exclude"]).trim());
  mkdirSync(dirname(archivo), { recursive: true });
  const actual = existsSync(archivo) ? readFileSync(archivo, "utf8") : "";
  const faltan = patrones.filter((p) => !actual.split("\n").includes(p));
  if (faltan.length === 0) return "Las exclusiones de git ya estaban";
  appendFileSync(archivo, `${actual === "" || actual.endsWith("\n") ? "" : "\n"}${faltan.join("\n")}\n`);
  return `Se excluyeron de git: ${faltan.join(", ")}`;
}

function instalarPostCommit(repo: string, bin: string): string {
  const dir = resolve(repo, git(repo, ["rev-parse", "--git-path", "hooks"]).trim());
  const archivo = join(dir, "post-commit");
  const linea = `node "${bin}" hook commit || true  ${MARCA}`;
  mkdirSync(dir, { recursive: true });
  if (!existsSync(archivo)) {
    writeFileSync(archivo, `#!/bin/sh\n${linea}\n`);
    chmodSync(archivo, 0o755);
    return "Se instaló el hook post-commit";
  }
  const actual = readFileSync(archivo, "utf8");
  if (actual.includes(MARCA)) return "El hook post-commit ya llamaba a rastro";
  const [primera = "", ...resto] = actual.split("\n");
  if (!/^#!.*\b(sh|bash|zsh|dash)\b/.test(primera)) {
    return `El post-commit existente no es un script de shell: agregá a mano esta línea: ${linea}`;
  }
  // Va justo después del shebang: si el hook original termina con `exit`, igual corre.
  writeFileSync(archivo, [primera, linea, ...resto].join("\n"));
  return "Se encadenó rastro al hook post-commit existente";
}

function instalarSessionEnd(repo: string, bin: string): string {
  const archivo = join(repo, ".claude", "settings.local.json");
  const comando = `node "${bin}" hook session-end`;
  let ajustes: Record<string, unknown> = {};
  if (existsSync(archivo)) {
    try {
      const leido: unknown = JSON.parse(readFileSync(archivo, "utf8"));
      if (typeof leido !== "object" || leido === null || Array.isArray(leido)) throw new Error("no es un objeto JSON");
      ajustes = leido as Record<string, unknown>;
    } catch (e) {
      throw new ErrorUsuario(".claude/settings.local.json no es JSON válido: no lo toco. Arreglalo y volvé a correr `rastro init`.", { cause: e });
    }
  }
  const hooks = (typeof ajustes["hooks"] === "object" && ajustes["hooks"] !== null ? ajustes["hooks"] : {}) as Record<string, unknown>;
  const sessionEnd = Array.isArray(hooks["SessionEnd"]) ? (hooks["SessionEnd"] as unknown[]) : [];
  if (JSON.stringify(sessionEnd).includes("hook session-end")) return "El hook SessionEnd de Claude Code ya llamaba a rastro";
  sessionEnd.push({ hooks: [{ type: "command", command: comando }] });
  hooks["SessionEnd"] = sessionEnd;
  ajustes["hooks"] = hooks;
  mkdirSync(dirname(archivo), { recursive: true });
  writeFileSync(archivo, `${JSON.stringify(ajustes, null, 2)}\n`);
  return "Se agregó el hook SessionEnd en .claude/settings.local.json";
}

export async function cmdInit(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { equipo: { type: "string", default: "AI Day" } } });
  const repo = raizDelRepo(process.cwd());
  for (const hecho of inicializar(repo, { equipo: values.equipo, binRastro: BIN_RASTRO })) process.stdout.write(`- ${hecho}\n`);
  process.stdout.write("Listo. Armá el plan con `rastro plan <propuesta.md>` y generá el día con `rastro daily`.\n");
  return 0;
}
