import type { Snapshot } from "../contract/snapshot.ts";
import type { Conector } from "./conector.ts";

export class ConectorCentral implements Conector {
  readonly nombre = "central";
  readonly #url: string;

  constructor(url: string) {
    this.#url = url.replace(/\/+$/, "");
  }

  async publicar(s: Snapshot): Promise<string> {
    let respuesta: Response;
    try {
      respuesta = await fetch(`${this.#url}/api/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(s),
      });
    } catch (e) {
      throw new Error(`no se pudo conectar con el central en ${this.#url}`, { cause: e });
    }
    if (respuesta.status !== 201) throw new Error(`el central respondió ${respuesta.status}: ${(await respuesta.text()).slice(0, 200)}`);
    return `publicado en ${this.#url}`;
  }
}
