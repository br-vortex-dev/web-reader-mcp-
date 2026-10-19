// Testes do diff_page (snapshot + diff de pagina).
//
// O que se quer garantir:
// - a primeira leitura GRAVA a marca e diz isso (nao e erro);
// - pagina identica devolve "sem mudanca";
// - pagina que mudou devolve SO a linha que mudou, marcada;
// - force regrava a marca sem comparar;
// - normalizacao: espaco no fim da linha e linha vazia repetida nao sao mudanca;
// - o diff de linhas acerta LCS no caso real (prefixo/sufixo comuns).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFixture, startMcp } from "./helpers.mjs";
import { diffDeLinhas, normalizarParaDiff, hashConteudo } from "../src/snapshot.mjs";

let fixture;
let mcp;

before(async () => {
  fixture = await startFixture();
  // Cache curto (o mínimo é 500 ms): o teste precisa que a SEGUNDA leitura
  // volte a baixar a página, senão o cache serve o mesmo payload e o diff
  // nunca veria a mudança que a fixture faz.
  mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", CACHE_TTL_MS: "500" });
});

/** Espera o cache da página vencer (TTL 500 ms) antes de reler. */
const vencerCache = () => new Promise((r) => setTimeout(r, 650));

after(async () => {
  await mcp.close();
  await fixture.close();
});

test("primeira leitura grava a marca e avisa que e a primeira", async () => {
  const r = await mcp.call("diff_page", { url: `${fixture.url}/diff/estavel` });
  assert.equal(r.isError, false);
  assert.match(r.text, /PRIMEIRA leitura/);
  assert.match(r.text, /Hash: [0-9a-f]{32}/);
});

test("segunda leitura de pagina identica: sem mudanca", async () => {
  await mcp.call("diff_page", { url: `${fixture.url}/diff/estavel` });
  const r = await mcp.call("diff_page", { url: `${fixture.url}/diff/estavel` });
  assert.equal(r.isError, false);
  assert.match(r.text, /SEM MUDANCA/);
});

test("pagina que mudou devolve so a linha alterada", async () => {
  const url = `${fixture.url}/diff/muda`;
  await mcp.call("diff_page", { url });
  await vencerCache();
  const r = await mcp.call("diff_page", { url });
  assert.equal(r.isError, false);
  assert.match(r.text, /Estado: MUDOU/);
  assert.match(r.text, /## Removido/);
  assert.match(r.text, /Versao \d+/);
  assert.match(r.text, /Linhas: \+1 \/ -1/);
  // O que nao mudou nao pode aparecer no diff.
  assert.doesNotMatch(r.text, /Paragrafo que nunca muda/);
});

test("a marca avanca: o diff seguinte mede a partir do novo conteudo", async () => {
  const url = `${fixture.url}/diff/muda`;
  await mcp.call("diff_page", { url });
  await vencerCache();
  await mcp.call("diff_page", { url }); // comparou e avancou
  await vencerCache();
  const r = await mcp.call("diff_page", { url });
  assert.equal(r.isError, false);
  // Mudou de novo (o contador sobe a cada leitura), e so uma linha difere.
  assert.match(r.text, /Linhas: \+1 \/ -1/);
  assert.doesNotMatch(r.text, /Paragrafo que nunca muda/);
});

test("force regrava a marca sem comparar", async () => {
  const url = `${fixture.url}/diff/muda`;
  await mcp.call("diff_page", { url });
  const r = await mcp.call("diff_page", { url, force: true });
  assert.equal(r.isError, false);
  assert.match(r.text, /PRIMEIRA leitura/);
});

test("normalizacao: espaco no fim, linha vazia sobrando e quebra final nao contam", () => {
  const a = "linha um\nlinha dois";
  const b = "linha um   \nlinha dois\n\n\n";
  assert.equal(normalizarParaDiff(a), "linha um\nlinha dois");
  assert.equal(normalizarParaDiff(a), normalizarParaDiff(b));
  // Uma linha vazia NO MEIO é estrutura de verdade: continua sendo mudança.
  assert.notEqual(normalizarParaDiff("a\nb"), normalizarParaDiff("a\n\nb"));
});

test("hash e estavel para o mesmo texto e diferente quando muda", () => {
  assert.equal(hashConteudo("abc"), hashConteudo("abc"));
  assert.notEqual(hashConteudo("abc"), hashConteudo("abd"));
});

test("diffDeLinhas: prefixo/sufixo comuns nao viram ruido", () => {
  const antes = "A\nB\nC\nD\nE";
  const depois = "A\nB\nX\nD\nE";
  const d = diffDeLinhas(antes, depois);
  assert.deepEqual(d.adicionadas, ["X"]);
  assert.deepEqual(d.removidas, ["C"]);
  assert.equal(d.iguais, false);
});

test("diffDeLinhas: textos iguais devolvem iguais=true", () => {
  const d = diffDeLinhas("A\nB", "A\nB");
  assert.equal(d.iguais, true);
});
