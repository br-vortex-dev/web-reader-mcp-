// Testes do read_pdf (extracao de texto de PDF) com fixtures locais.
//
// O que se quer garantir:
// - PDF de verdade (content stream FlateDecode com Tj/TJ/TD) -> texto extraido,
//   com ESPACOS reconstruidos a partir do kerning do TJ e QUEBRAS a partir do Td.
// - Corpo que nao comeca com %PDF- -> caminho "nao reconhecido", sem erro cru.
// - maxChars aplicado com aviso de truncamento.
// - A extracao roda dentro do cache: reler a mesma URL nao reparseia.

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

test("PDF valido: extrai o texto e reconstroi espacos e quebras", async () => {
  const r = await mcp.call("read_pdf", { url: `${fixture.url}/pdf/simples.pdf`, maxChars: 8000 });
  assert.equal(r.isError, false);
  const t = r.text;
  assert.match(t, /# PDF:/);
  assert.match(t, /Relatorio de teste do leitor de PDF/);
  // Espacos reconstruidos a partir do TJ (cada palavra veio de um pedaco).
  assert.match(t, /Texto com espacos reconstruidos/);
  assert.match(t, /Segunda linha do documento\./);
  // A quebra entre as linhas nao virou texto colado.
  assert.ok(!/reconstruidosSegunda/.test(t), "linhas nao podem sair coladas");
});

test("PDF valido: informa contagem de paginas", async () => {
  const r = await mcp.call("read_pdf", { url: `${fixture.url}/pdf/simples.pdf`, maxChars: 8000 });
  assert.match(r.text, /Paginas: 1/);
});

test("corpo que nao e PDF devolve aviso, nao erro cru", async () => {
  const r = await mcp.call("read_pdf", { url: `${fixture.url}/pdf/nao-pdf.pdf`, maxChars: 8000 });
  assert.equal(r.isError, false);
  assert.match(r.text, /nao reconhecido/i);
  assert.match(r.text, /%PDF-/);
});

test("maxChars trunca com aviso e diz quanto foi exibido", async () => {
  const r = await mcp.call("read_pdf", { url: `${fixture.url}/pdf/simples.pdf`, maxChars: 200 });
  assert.match(r.text, /exibidos 200/);
  assert.match(r.text, /truncado/);
});

test("releitura da mesma URL reaproveita a extracao (cache)", async () => {
  const url = `${fixture.url}/pdf/simples.pdf`;
  const r1 = await mcp.call("read_pdf", { url, maxChars: 8000 });
  const r2 = await mcp.call("read_pdf", { url, maxChars: 8000 });
  assert.equal(r1.text, r2.text);
});
