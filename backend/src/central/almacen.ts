import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validarSnapshot, type Snapshot } from "../contract/snapshot.ts";
import { RE_SLUG } from "../contract/validar.ts";

/** Último snapshot de cada persona, un archivo JSON por persona. */
export class Almacen {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  guardar(s: Snapshot): void {
    // persona.id ya pasó por el contrato como slug: no puede apuntar fuera del directorio.
    const destino = join(this.#dir, `${s.persona.id}.json`);
    const temporal = `${destino}.tmp`;
    writeFileSync(temporal, JSON.stringify(s));
    renameSync(temporal, destino); // Una lectura simultánea nunca ve un archivo a medio escribir.
  }

  leer(id: string): Snapshot | null {
    if (!RE_SLUG.test(id)) return null;
    const archivo = join(this.#dir, `${id}.json`);
    return existsSync(archivo) ? validarSnapshot(JSON.parse(readFileSync(archivo, "utf8"))) : null;
  }

  todos(): Snapshot[] {
    return readdirSync(this.#dir)
      .filter((f) => f.endsWith(".json"))
      .flatMap((f) => {
        const s = this.leer(f.slice(0, -".json".length));
        return s === null ? [] : [s];
      });
  }
}
