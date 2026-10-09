import type { Snapshot } from "../contract/snapshot.ts";
import type { Conector } from "./conector.ts";

export class ConectorCentral implements Conector {
  readonly nombre = "central";
  readonly #url: string;
  readonly #timeoutMs: number;

  constructor(url: string, timeoutMs = 10_000) {
    this.#url = url.replace(/\/+$/, "");
    this.#timeoutMs = timeoutMs;
  }

  async publicar(s: Snapshot): Promise<string> {
    let respuesta: Response;
    try {
      respuesta = await fetch(`${this.#url}/api/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(s),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (e) {
      if (e instanceof Error && e.name === "TimeoutError") {
        throw new Error(`el central en ${this.#url} no respondió en ${this.#timeoutMs / 1000} s`, { cause: e });
      }
      throw new Error(`no se pudo conectar con el central en ${this.#url}`, { cause: e });
    }
    if (respuesta.status !== 201) throw new Error(`el central respondió ${respuesta.status}: ${(await respuesta.text()).slice(0, 200)}`);
    return `publicado en ${this.#url}`;
  }
}
