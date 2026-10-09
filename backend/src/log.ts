type Nivel = "debug" | "info" | "warn" | "error";

const ORDEN: Record<Nivel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function nivelMinimo(): Nivel {
  const v = process.env["RASTRO_LOG"];
  return v === "debug" || v === "info" || v === "warn" || v === "error" ? v : "info";
}

export function log(nivel: Nivel, evento: string, campos: Record<string, string | number | boolean> = {}): void {
  if (ORDEN[nivel] < ORDEN[nivelMinimo()]) return;
  const pares = Object.entries(campos).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  process.stderr.write(`rastro ${nivel} ${evento}${pares.length > 0 ? ` ${pares.join(" ")}` : ""}\n`);
}
