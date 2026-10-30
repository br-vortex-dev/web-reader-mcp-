// Testes do find_on_page.
//
// O que se quer garantir:
// - encontra o termo e devolve SÓ os trechos, com numero de linha;
// - acha texto literal (inclusive com caracteres de regex, sem explodir);
// - regex de verdade funciona quando pedida;
// - termo ausente devolve aviso, nao pagina vazia silenciosa;
// - maxHits respeita o teto;
// - a busca reaproveita a conversao (nao reconverte a pagina a cada chamada).

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
  await mcp.close();
  await fixture.close();
});

test("acha a ocorrencia e devolve a linha com contexto", async () => {
  const r = await mcp.call("find_on_page", { url: `${fixture.url}/`, query: "CASO 9" });
  assert.equal(r.isError, false);
  assert.match(r.text, /Ocorrencias: 1/);
  assert.match(r.text, /> *\d+\| .*CASO 9/);
});

test("termo literal com caractere de regex ('3 < 5') nao quebra", async () => {
  const r = await mcp.call("find_on_page", { url: `${fixture.url}/`, query: "3 < 5" });
  assert.equal(r.isError, false);
  // Deve ser tratado como texto, nao como regex (que lancaria ou casaria errado).
  assert.match(r.text, /Ocorrencias: [1-9]/);
});

test("regex de verdade quando regex:true", async () => {
  const r = await mcp.call("find_on_page", { url: `${fixture.url}/`, query: "CASO \\d+", regex: true });
  assert.equal(r.isError, false);
  const m = r.text.match(/Ocorrencias: (\d+)/);
  assert.ok(Number(m[1]) >= 3, `esperava varias ocorrencias, achou ${m[1]}`);
});

test("regex invalida devolve erro de parametro claro", async () => {
  const r = await mcp.call("find_on_page", { url: `${fixture.url}/`, query: "([", regex: true });
  assert.equal(r.isError, true);
  assert.match(r.text, /regex inválida|regex invalida/);
});

test("termo ausente avisa em vez de devolver vazio", async () => {
  const r = await mcp.call("find_on_page", { url: `${fixture.url}/`, query: "zzz-nao-existe-zzz" });
  assert.equal(r.isError, false);
  assert.match(r.text, /Nenhuma ocorrencia/);
});

test("contexto 0 devolve so a linha do acerto", async () => {
  const r = await mcp.call("find_on_page", { url: `${fixture.url}/`, query: "CASO 9", contexto: 0 });
  assert.equal(r.isError, false);
  assert.match(r.text, /Ocorrencias: 1/);
  // A linha do acerto vem marcada com ">"; nenhuma linha de contexto (" ") pode aparecer.
  assert.match(r.text, /^> *\d+\| .*CASO 9/m);
  assert.doesNotMatch(r.text, /^ +\d+\|/m);
});

test("maxHits limita os blocos e sinaliza o que ficou de fora", async () => {
  const r = await mcp.call("find_on_page", { url: `${fixture.url}/`, query: "CASO", maxHits: 2 });
  assert.equal(r.isError, false);
  assert.match(r.text, /exibindo 2/);
  assert.match(r.text, /alem do limite/);
});

test("sem query devolve erro de parametro", async () => {
  const r = await mcp.call("find_on_page", { url: `${fixture.url}/` });
  assert.equal(r.isError, true);
  assert.match(r.text, /query/);
});
