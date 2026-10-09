import { test } from "node:test";
import assert from "node:assert/strict";
import { redactar } from "../src/redactar.ts";

test("redacta tokens conocidos", () => {
  const gh = `ghp_${"a".repeat(36)}`;
  const r = redactar(`export GITHUB_TOKEN=${gh} && curl -H 'Authorization: Bearer abcdefghijklmnop' https://x`);
  assert.ok(!r.includes(gh));
  assert.ok(!r.includes("abcdefghijklmnop"));
  assert.match(r, /GITHUB_TOKEN=\[redactado\]/);
});

test("redacta asignaciones de *_KEY, *_TOKEN y password", () => {
  const r = redactar("OPENAI_API_KEY='sk-proj-abc123def456' mysql --password=hunter2 AWS=AKIAABCDEFGHIJKLMNOP");
  assert.ok(!r.includes("sk-proj-abc123def456"));
  assert.ok(!r.includes("hunter2"));
  assert.ok(!r.includes("AKIAABCDEFGHIJKLMNOP"));
});

test("redacta asignaciones sin prefijo en el nombre", () => {
  for (const entrada of ["SECRET=abc123", "TOKEN=abc123", "KEY=abc123", "--token=abc123"]) {
    const r = redactar(entrada);
    assert.ok(!r.includes("abc123"), entrada);
    assert.match(r, /\[redactado\]/, entrada);
  }
});

test("una asignación dentro de un string JSON deja el JSON válido y sin el secreto", () => {
  const r = redactar('{"msg":"API_KEY=abc123","x":1}');
  assert.equal(r, '{"msg":"API_KEY=[redactado]","x":1}');
  JSON.parse(r);
});

test("comillas escapadas dentro de JSON: el resultado sigue siendo JSON y no filtra", () => {
  const simple = redactar(JSON.stringify({ cmd: 'export TOKEN="abc123" && ls' }));
  assert.equal(simple, '{"cmd":"export TOKEN=[redactado] && ls"}');
  JSON.parse(simple);
  const conEspacio = redactar(JSON.stringify({ cmd: 'export TOKEN="abc def" && ls' }));
  assert.equal(conEspacio, '{"cmd":"export TOKEN=[redactado] && ls"}');
  JSON.parse(conEspacio);
});

test("comilla de apertura sin cerrar redacta hasta el fin de línea", () => {
  assert.equal(redactar('export TOKEN="abc123'), "export TOKEN=[redactado]");
  assert.equal(redactar("KEY='abc"), "KEY=[redactado]");
  assert.equal(redactar('TOKEN="abc def'), "TOKEN=[redactado]");
  assert.equal(redactar('TOKEN="abc def\nok'), "TOKEN=[redactado]\nok");
});

test("una barra invertida dentro del secreto no deja cola", () => {
  assert.equal(redactar("PASSWORD=ab\\cd"), "PASSWORD=[redactado]");
});

test("una asignación vacía dentro de JSON no consume las comillas siguientes", () => {
  const r = redactar('{"m":"API_KEY=","x":"y"}');
  assert.equal(r, '{"m":"API_KEY=[redactado]","x":"y"}');
  JSON.parse(r);
});

test("no toca texto sin secretos", () => {
  assert.equal(redactar("git commit -m 'arreglo el parser'"), "git commit -m 'arreglo el parser'");
});
