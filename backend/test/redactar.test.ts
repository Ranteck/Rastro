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
  assert.ok(!r.includes("abc123"));
  assert.deepEqual(JSON.parse(r), { msg: "API_KEY=[redactado]", x: 1 });
});

test("una asignación con comillas escapadas dentro de JSON no filtra ni rompe el JSON", () => {
  const r = redactar(JSON.stringify({ cmd: 'export TOKEN="abc123" && ls' }));
  assert.ok(!r.includes("abc123"));
  assert.doesNotThrow(() => JSON.parse(r));
});

test("redacta valores con comilla de apertura sin cerrar", () => {
  for (const entrada of ['export TOKEN="abc123', "KEY='abc"]) {
    const r = redactar(entrada);
    assert.ok(!/abc/.test(r), entrada);
  }
});

test("no toca texto sin secretos", () => {
  assert.equal(redactar("git commit -m 'arreglo el parser'"), "git commit -m 'arreglo el parser'");
});
