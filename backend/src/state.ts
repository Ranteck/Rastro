import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rutasGlobales } from "./config.ts";
import { validarSnapshot, type Snapshot } from "./contract/snapshot.ts";
import { ErrorValidacion } from "./contract/validar.ts";
import { ErrorUsuario } from "./errores.ts";

/** El último `rastro daily`, validado. */
export function leerState(): Snapshot {
  const archivo = rutasGlobales().state;
  if (!existsSync(archivo)) throw new ErrorUsuario(`No hay ${archivo}: corré \`rastro daily\` primero (o decile a Claude «cerrá el día»).`);
  try {
    return validarSnapshot(JSON.parse(readFileSync(archivo, "utf8")));
  } catch (e) {
    if (e instanceof ErrorValidacion || e instanceof SyntaxError) {
      throw new ErrorUsuario(`${archivo} no cumple el contrato (${e.message}): volvé a correr \`rastro daily\`.`, { cause: e });
    }
    throw e;
  }
}

export function guardarState(snapshot: Snapshot): void {
  mkdirSync(rutasGlobales().dir, { recursive: true });
  writeFileSync(rutasGlobales().state, `${JSON.stringify(snapshot, null, 2)}\n`);
}
