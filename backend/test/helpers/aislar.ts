import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Se carga antes que cualquier test (node --import): ningún test puede llegar al ~/.rastro/ ni al ~/.claude/ reales.
const base = mkdtempSync(join(tmpdir(), "rastro-aislado-"));
const temporales = join(base, "tmp");
mkdirSync(temporales);
process.env["HOME"] = join(base, "home");
process.env["RASTRO_HOME"] = join(base, "rastro");
// Todo mkdtemp(tmpdir()) de los tests cae adentro de `base`, que se borra al salir: /tmp es tmpfs y se queda sin inodos.
process.env["TMPDIR"] = temporales;
process.on("exit", () => rmSync(base, { recursive: true, force: true }));
