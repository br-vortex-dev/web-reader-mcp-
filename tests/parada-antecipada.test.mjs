// Testes da parada antecipada: quando a pagina passa do que pode ser
// entregue, o servidor para de baixar e de converter o rabo que ninguem
// veria — sem mudar UM BYTE do texto que o cliente recebe.
//
// Uso: node --test tests/parada-antecipada.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { HARD_MAX_CHARS } from "../src/config.mjs";
import { htmlToMarkdown } from "../src/html-parser.mjs";
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

test("download aborta ao passar do teto de bytes, sem depender do content-length", { timeout: 60000 }, async () => {
  // MAX_RESPONSE_BYTES baixo: o /enorme manda 1 MB sem content-length (chunked).
  // O corte tem de vir da contagem REAL do streaming, e o erro tem de ser o
  // esperado (nunca um estouro de memoria nem um travamento).
  const mcp2 = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", MAX_RESPONSE_BYTES: "262144" });
  try {
    const r = await mcp2.call("read_page", {
      url: `${fixture.url}/enorme`,
      maxChars: 2000,
      timeoutMs: 20000,
    });
    assert.equal(r.isError, true, `deveria falhar com resposta grande: ${r.text.slice(0, 200)}`);
    assert.match(r.text, /Resposta muito grande/, `erro inesperado: ${r.text.slice(0, 300)}`);
  } finally {
    mcp2.close();
  }
});

test("pagina gigante: o texto exibido e identico ao da conversao completa", { timeout: 60000 }, async () => {
  // O contrato central da parada: o prefixo entregavel nao muda. O servidor
  // converte com a parada ligada; aqui comparamos o resultado servido com a
  // conversao COMPLETA do mesmo HTML — os HARD_MAX_CHARS primeiros tem de ser
  // identicos, e a pagina tem de CONTER o inicio mas o corte (sem o fim).
  const r = await mcp.call("read_page", {
    url: `${fixture.url}/gigante`,
    maxChars: HARD_MAX_CHARS,
    timeoutMs: 30000,
  });
  assert.equal(r.isError, false, `read_page falhou: ${r.text.slice(0, 300)}`);

  // O inicio da pagina (antes do teto) esta la.
  assert.match(r.text, /INICIO-GIGANTE/);
  // O fim (que so existiria numa conversao completa > 250k) nao precisa estar.
  assert.doesNotMatch(r.text, /FIM-GIGANTE/);

  // A marca honesta do corte: o campo `Conteudo:` avisa que havia mais.
  assert.match(
    r.text,
    /Conteudo: \d+\+ caracteres/,
    `o + de interrupcao deveria estar no cabecalho: ${r.text.slice(0, 200)}`
  );

  // Fidelidade prova a prova: conversao completa do mesmo HTML, prefixo igual.
  // Reconstroi o mesmo HTML que o fixture serve (mesma geracao).
  const blocos = Array.from(
    { length: 900 },
    (_, i) =>
      `<p>Paragrafo ${i} de enchimento para empurrar a pagina muito alem do teto de saida do servidor. ` +
      `Texto repetido de proposito para o markdown passar de 250 mil caracteres sem esforco. ` +
      `${"palavra ".repeat(6)}</p>`
  ).join("");
  const htmlGigante =
    `<!DOCTYPE html><html><head><title>Pagina Gigante</title></head><body>` +
    `<h1>INICIO-GIGANTE</h1>${blocos}<h1>FIM-GIGANTE</h1></body></html>`;

  const completo = htmlToMarkdown(htmlGigante, `${fixture.url}/gigante`);
  assert.ok(completo.length > HARD_MAX_CHARS, `a pagina deveria passar do teto: ${completo.length}`);

  // O texto servido tem de CONTER os HARD_MAX_CHARS primeiros da conversao
  // completa: e isso que prova que nada entregavel mudou com a parada.
  const exibivelCompleto = completo.slice(0, HARD_MAX_CHARS);
  assert.ok(
    r.text.includes(exibivelCompleto),
    "os caracteres entregaveis divergiram da conversao completa"
  );
  // E o aviso de truncamento fecha o corpo servido.
  assert.match(r.text, /conteudo truncado em \d+ caracteres/);
});

test("a parada nao interfere em paginas pequenas (resultado identico)", () => {
  // Para pagina menor que o teto, o resultado com parada e o historico tem de
  // ser exatamente o mesmo — byte a byte.
  const html =
    "<!DOCTYPE html><html><head><title>Pequena</title></head><body>" +
    "<h1>Titulo</h1><p>Texto curto com <a href='/x'>link</a> e <b>negrito</b>.</p>" +
    "<pre>codigo\n  indentado\n</pre></body></html>";
  const completa = htmlToMarkdown(html, "https://exemplo.com/");
  const comParada = htmlToMarkdown(html, "https://exemplo.com/", {
    minCharsEntregaveis: HARD_MAX_CHARS,
  });
  assert.equal(comParada, completa);
});

test("a parada mantem o pareamento de cercas de codigo no prefixo exibido", () => {
  // Muitos blocos de codigo: a conversao para no teto entregavel, mas o que
  // sai tem de estar com as cercas balanceadas (markdown valido).
  const blocos = Array.from(
    { length: 400 },
    (_, i) =>
      `<h2>Secao ${i}</h2><p>${"conteudo de enchimento ".repeat(12)}</p>` +
      `<pre>codigo ${i}\n  linha ${i}\n</pre>`
  ).join("");
  const html = `<!DOCTYPE html><html><body>${blocos}</body></html>`;
  const diag = { interrompida: false };
  const resultado = htmlToMarkdown(html, "https://exemplo.com/", {
    minCharsEntregaveis: HARD_MAX_CHARS,
    diagnostico: diag,
  });
  assert.equal(diag.interrompida, true, "deveria ter interrompido");
  const cercas = (resultado.match(/```/g) || []).length;
  assert.equal(cercas % 2, 0, `cercas desemparelhadas no resultado: ${cercas}`);
});
