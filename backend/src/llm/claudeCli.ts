import { spawn } from "node:child_process";
import type { Costo } from "../contract/snapshot.ts";
import { bool, desconocido, num, objAbierto } from "../contract/validar.ts";
import { log } from "../log.ts";
import { ErrorLlm, type Llm, type PedidoLlm } from "./llm.ts";

export type Ejecutor = (
  bin: string,
  args: readonly string[],
  entrada: string,
  timeoutMs: number,
  cwd?: string,
) => Promise<{ codigo: number | null; stdout: string; stderr: string }>;

export const ejecutarProceso: Ejecutor = (bin, args, entrada, timeoutMs, cwd) =>
  new Promise((resolve, reject) => {
    // AbortSignal.timeout no deja un timer armado si el binario no existe (spawn({ timeout }) sí lo dejaba, colgando el proceso).
    const hijo = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], signal: AbortSignal.timeout(timeoutMs), ...(cwd === undefined ? {} : { cwd }) });
    let stdout = "";
    let stderr = "";
    hijo.stdout.setEncoding("utf8").on("data", (d: string) => {
      stdout += d;
    });
    hijo.stderr.setEncoding("utf8").on("data", (d: string) => {
      stderr += d;
    });
    hijo.on("error", (e) => {
      reject(e.name === "AbortError" ? new ErrorLlm(`claude superó el timeout de ${timeoutMs} ms`, { cause: e }) : e); // ENOENT si claude no está instalado
    });
    hijo.stdin.on("error", reject); // EPIPE si el proceso murió antes de leer el prompt
    hijo.on("close", (codigo) => resolve({ codigo, stdout, stderr }));
    hijo.stdin.end(entrada);
  });

// Salida de `claude -p --output-format json`: abierta porque Claude Code suma campos seguido.
const checkSalida = objAbierto(
  {
    is_error: bool,
    total_cost_usd: num,
    usage: objAbierto({ input_tokens: num, output_tokens: num }, { cache_creation_input_tokens: num, cache_read_input_tokens: num }),
  },
  { structured_output: desconocido },
);

export class ClaudeCli implements Llm {
  readonly #modelo: string;
  readonly #binario: string;
  readonly #timeoutMs: number;
  readonly #ejecutar: Ejecutor;
  #llamadas = 0;
  #usd = 0;
  #tokens = 0;

  constructor(o: { modelo: string; binario?: string; timeoutMs?: number; ejecutar?: Ejecutor }) {
    this.#modelo = o.modelo;
    this.#binario = o.binario ?? "claude";
    this.#timeoutMs = o.timeoutMs ?? 120_000;
    this.#ejecutar = o.ejecutar ?? ejecutarProceso;
  }

  costo(): Costo {
    return { llamadas: this.#llamadas, usd: Math.round(this.#usd * 1e6) / 1e6, tokens: this.#tokens };
  }

  async completar<T>(pedido: PedidoLlm<T>): Promise<T> {
    try {
      return await this.#intentar(pedido);
    } catch (e) {
      log("warn", "llm_reintento", { uso: pedido.uso, detalle: e instanceof Error ? e.message : String(e) });
    }
    try {
      return await this.#intentar(pedido);
    } catch (e) {
      throw new ErrorLlm(`${pedido.uso}: el LLM no respondió bien después de 2 intentos`, { cause: e });
    }
  }

  async #intentar<T>(pedido: PedidoLlm<T>): Promise<T> {
    // Sin settings, sin MCP y con system prompt corto: baja el costo por llamada de ~US$0.12 a ~US$0.0003
    // y evita que la sesión headless dispare los hooks del proyecto.
    const args = [
      "-p",
      "--output-format", "json",
      "--model", this.#modelo,
      "--tools", "",
      "--no-session-persistence",
      "--strict-mcp-config",
      "--setting-sources", "",
      "--system-prompt", pedido.sistema,
      "--json-schema", JSON.stringify(pedido.esquema),
    ];
    const r = await this.#ejecutar(this.#binario, args, pedido.prompt, this.#timeoutMs);
    if (r.codigo !== 0) throw new ErrorLlm(`claude salió con ${String(r.codigo)}: ${r.stderr.slice(0, 200)}`);
    const salida = checkSalida(JSON.parse(r.stdout), "claude");
    const u = salida.usage;
    this.#llamadas++;
    this.#usd += salida.total_cost_usd;
    this.#tokens += u.input_tokens + u.output_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    if (salida.is_error || salida.structured_output === undefined) throw new ErrorLlm(`${pedido.uso}: respuesta sin salida estructurada`);
    return pedido.validar(salida.structured_output, pedido.uso);
  }
}
