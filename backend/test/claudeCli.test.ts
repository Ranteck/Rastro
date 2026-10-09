import { test } from "node:test";
import assert from "node:assert/strict";
import { obj, str } from "../src/contract/validar.ts";
import { ClaudeCli, ejecutarProceso, type Ejecutor } from "../src/llm/claudeCli.ts";
import { ErrorLlm, type PedidoLlm } from "../src/llm/llm.ts";

const pedido: PedidoLlm<{ respuesta: string }> = {
  uso: "prueba",
  sistema: "Respondés solo JSON.",
  prompt: "decí ok",
  esquema: { type: "object", properties: { respuesta: { type: "string" } }, required: ["respuesta"], additionalProperties: false },
  validar: obj({ respuesta: str }),
};

// Forma real de `claude -p --output-format json --json-schema` (medida el 2026-10-09).
const salidaOk = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: '{"respuesta":"ok"}',
  structured_output: { respuesta: "ok" },
  total_cost_usd: 0.00025,
  usage: { input_tokens: 2, output_tokens: 55, cache_creation_input_tokens: 1133, cache_read_input_tokens: 0 },
  session_id: "x",
});

test("devuelve la salida estructurada, acumula costo y usa los flags baratos y sin herramientas", async () => {
  const llamadas: { args: readonly string[]; entrada: string }[] = [];
  const ejecutar: Ejecutor = async (_bin, args, entrada) => {
    llamadas.push({ args, entrada });
    return { codigo: 0, stdout: salidaOk, stderr: "" };
  };
  const llm = new ClaudeCli({ modelo: "haiku", ejecutar });
  assert.deepEqual(await llm.completar(pedido), { respuesta: "ok" });
  assert.deepEqual(llm.costo(), { llamadas: 1, usd: 0.00025, tokens: 1190 });
  const args = llamadas[0]?.args ?? [];
  assert.equal(llamadas[0]?.entrada, "decí ok");
  for (const [flag, valor] of [["--tools", ""], ["--setting-sources", ""], ["--model", "haiku"], ["--output-format", "json"]] as const) {
    assert.equal(args[args.indexOf(flag) + 1], valor);
  }
  assert.ok(args.includes("--no-session-persistence"));
  assert.ok(args.includes("--strict-mcp-config"));
});

test("reintenta una vez si la primera respuesta no sirve", async () => {
  let n = 0;
  const ejecutar: Ejecutor = async () => (++n === 1 ? { codigo: 0, stdout: "no es json", stderr: "" } : { codigo: 0, stdout: salidaOk, stderr: "" });
  assert.deepEqual(await new ClaudeCli({ modelo: "haiku", ejecutar }).completar(pedido), { respuesta: "ok" });
  assert.equal(n, 2);
});

test("después de dos fallas lanza ErrorLlm", async () => {
  const ejecutar: Ejecutor = async () => ({ codigo: 1, stdout: "", stderr: "boom" });
  await assert.rejects(new ClaudeCli({ modelo: "haiku", ejecutar }).completar(pedido), ErrorLlm);
});

test("una salida que no cumple el esquema cuenta como falla", async () => {
  const mala = JSON.stringify({ ...(JSON.parse(salidaOk) as object), structured_output: { otra: 1 } });
  const ejecutar: Ejecutor = async () => ({ codigo: 0, stdout: mala, stderr: "" });
  await assert.rejects(new ClaudeCli({ modelo: "haiku", ejecutar }).completar(pedido), ErrorLlm);
});

test("si el binario de claude no existe, ErrorLlm que lo dice y sin reintento", async () => {
  let intentos = 0;
  const real: Ejecutor = (...a) => {
    intentos++;
    return ejecutarProceso(...a);
  };
  await assert.rejects(
    new ClaudeCli({ modelo: "haiku", binario: "/no/existe/claude", ejecutar: real }).completar(pedido),
    (e) => e instanceof ErrorLlm && /No encontré `claude` en el PATH/.test(e.message),
  );
  assert.equal(intentos, 1);
});

test("ejecutarProceso corta el proceso al vencer el timeout", async () => {
  await assert.rejects(
    ejecutarProceso(process.execPath, ["-e", "setTimeout(()=>{},5000)"], "", 100),
    (e) => e instanceof ErrorLlm && /timeout/.test(e.message),
  );
});

test("ejecutarProceso entrega el prompt por stdin y devuelve stdout", async () => {
  const r = await ejecutarProceso(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], "hola", 5000);
  assert.deepEqual(r, { codigo: 0, stdout: "hola", stderr: "" });
});
