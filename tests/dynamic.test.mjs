// Testes do read_dynamic_page.
//
// O bug: quando dados embutidos eram encontrados, o cabecalho (titulo, URL,
// rotulo) saia DUAS vezes — uma montada a mao no fullText e outra pelo
// formatReadResult.
//
// Uso: node --test tests/...
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFixture, startMcp } from "./helpers.mjs";

let fixture;
let mcp;

before(async () => {
  fixture = await startFixture();
  mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1" });
});

after(async () => {
  mcp?.close();
  await fixture?.close();
});

const contar = (texto, regex) => (texto.match(regex) || []).length;

test("read_dynamic_page com dados embutidos monta o cabecalho uma unica vez", { timeout: 60000 }, async () => {
  const r = await mcp.call("read_dynamic_page", { url: `${fixture.url}/dinamica`, maxChars: 5000, timeoutMs: 10000 });
  assert.equal(r.isError, false, r.text);

  assert.equal(contar(r.text, /^# ComDados$/gm), 1, `titulo duplicado:\n${r.text}`);
  assert.equal(contar(r.text, /^URL: /gm), 1, `URL duplicada:\n${r.text}`);
  assert.equal(
    contar(r.text, /Pagina dinamica — dados extraidos do HTML embutido/g),
    1,
    `rotulo duplicado:\n${r.text}`
  );
  assert.equal(contar(r.text, /^Conteudo: /gm), 1, `contagem duplicada:\n${r.text}`);
  assert.equal(contar(r.text, /^Descricao: /gm), 1, `descricao duplicada:\n${r.text}`);
});

test("a correcao nao perdeu informacao util", { timeout: 60000 }, async () => {
  const r = await mcp.call("read_dynamic_page", { url: `${fixture.url}/dinamica`, maxChars: 5000, timeoutMs: 10000 });
  assert.equal(r.isError, false, r.text);

  // Cabecalho completo, uma vez cada.
  assert.match(r.text, /^# ComDados$/m, "titulo");
  assert.match(r.text, /^URL: http:\/\/127\.0\.0\.1:\d+\/dinamica$/m, "URL");
  assert.match(r.text, /^Descricao: Descricao de teste$/m, "descricao");
  assert.match(r.text, /^Pagina dinamica — dados extraidos do HTML embutido$/m, "rotulo");
  assert.match(r.text, /^Conteudo: \d+ caracteres/m, "contagem");

  // E os dados embutidos continuam la.
  assert.match(r.text, /__NEXT_DATA__/, "secao de dados embutidos");
  assert.match(r.text, /Produto X/, "dado extraido");
  assert.match(r.text, /123\.45/, "dado numerico extraido");
});

test("read_dynamic_page em pagina estatica tambem tem cabecalho unico", { timeout: 60000 }, async () => {
  const r = await mcp.call("read_dynamic_page", { url: `${fixture.url}/pagina`, maxChars: 3000, timeoutMs: 10000 });
  assert.equal(r.isError, false, r.text);
  assert.equal(contar(r.text, /^# Fixture Parser$/gm), 1, `titulo duplicado:\n${r.text.slice(0, 400)}`);
  assert.equal(contar(r.text, /^URL: /gm), 1);
  assert.equal(contar(r.text, /^Conteudo: /gm), 1);
  assert.match(r.text, /Pagina estatica \(nao precisa de JavaScript\)/);
});
