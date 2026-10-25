// Testes de COBERTURA: quando a ferramenta so ve um pedaço da pagina, o
// resultado tem de DIZER que ve um pedaço.
//
// Os tres casos abaixo nasceram medidos em producao pela bateria de sites
// pesados (scripts/stress-peso.mjs), numa instancia no Render:
//
//  - find_on_page numa pagina de 12 MB: o download vem inteiro (o teto de
//    documento e 24 MB), mas a CONVERSAO para texto para no teto de saida. A
//    busca rodou sobre ~60 mil caracteres e devolveu "1 ocorrencia" sem nada
//    que separasse "o termo e raro" de "nao cheguei ate la".
//  - diff_page na mesma pagina: gravava marca sobre esse texto parcial, e uma
//    mudanca no resto do documento leria "SEM MUDANCA".
//  - read_page numa casca de JavaScript: devolvia 95 caracteres (so o titulo e
//    o link de login) como se fossem a pagina toda, porque o aviso antigo so
//    disparava com ZERO caracteres.
//
// O que se quer garantir aqui, entao: aviso quando cobriu pouco, NENHUM aviso
// quando cobriu tudo, e recusa quando o parcial seria uma mentira.

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

/* ------------------------- find_on_page: cobertura ------------------------- */

test("find_on_page: termo que so existe depois do teto de conversao avisa que nao cobriu", async () => {
  const r = await mcp.call("find_on_page", { url: `${fixture.url}/gigante`, query: "FIM-GIGANTE" });
  assert.equal(r.isError, false);
  // O termo esta no HTML, mas o texto convertido para antes dele: "nenhuma
  // ocorrencia" sem aviso diria ao cliente que a pagina nao fala do assunto.
  assert.match(r.text, /Nenhuma ocorrencia/);
  assert.match(r.text, /AVISO/, "a busca parcial tem de vir sinalizada");
  assert.match(r.text, /converter inteira/);
});

test("find_on_page: com acertos na frente coberta, o aviso de cobertura sai igual", async () => {
  const r = await mcp.call("find_on_page", { url: `${fixture.url}/gigante`, query: "INICIO-GIGANTE" });
  assert.equal(r.isError, false);
  assert.match(r.text, /INICIO-GIGANTE/);
  assert.match(r.text, /AVISO: a pagina e grande demais para converter inteira/);
});

test("find_on_page: pagina que cabe toda no teto NAO leva aviso de cobertura", async () => {
  const r = await mcp.call("find_on_page", { url: `${fixture.url}/longa`, query: "Paragrafo 7 com" });
  assert.equal(r.isError, false);
  assert.match(r.text, /Paragrafo 7 com/);
  assert.doesNotMatch(r.text, /AVISO/, "aviso de cobertura em pagina inteira e ruido");
});

/* ----------------------------- diff_page: marca ---------------------------- */

test("diff_page: recusa pagina maior que o teto de conversao (marca parcial mentiria)", async () => {
  const url = `${fixture.url}/gigante`;
  const r = await mcp.call("diff_page", { url });
  assert.equal(r.isError, true);
  assert.match(r.text, /Nao foi possivel obter o texto inteiro/);

  // A recusa tambem nao gravou nada: uma segunda chamada continua a recusar,
  // em vez de "SEM MUDANCA" comparando contra um hash de meio documento.
  const r2 = await mcp.call("diff_page", { url });
  assert.equal(r2.isError, true);
  assert.doesNotMatch(r2.text, /SEM MUDANCA|PRIMEIRA leitura/);
});

test("diff_page: pagina que cabe inteiro continua a gravar a marca", async () => {
  const url = `${fixture.url}/diff/estavel`;
  const primeiro = await mcp.call("diff_page", { url });
  assert.equal(primeiro.isError, false);
  assert.match(primeiro.text, /PRIMEIRA leitura/);
  const segundo = await mcp.call("diff_page", { url });
  assert.equal(segundo.isError, false);
  assert.match(segundo.text, /SEM MUDANCA/);
});

/* ---------------------------- read_page: casca ---------------------------- */

test("read_page: casca de JavaScript com migalhas de texto e marcada como casca", async () => {
  const r = await mcp.call("read_page", { url: `${fixture.url}/casca` });
  assert.equal(r.isError, false);
  assert.match(r.text, /conteudo estatico muito curto/);
  assert.match(r.text, /Tente read_dynamic_page/);
});

test("read_page: pagina curta SEM script nao e chamada de casca de JavaScript", async () => {
  const r = await mcp.call("read_page", { url: `${fixture.url}/pequena` });
  assert.equal(r.isError, false);
  assert.match(r.text, /Pagina Pequena/);
  assert.doesNotMatch(r.text, /muito curto/, "pagina pequena de verdade nao e pagina quebrada");
});

test("read_page: pagina cheia nao leva nenhum aviso de casca", async () => {
  const r = await mcp.call("read_page", { url: `${fixture.url}/longa` });
  assert.equal(r.isError, false);
  assert.doesNotMatch(r.text, /muito curto|read_dynamic_page/);
});
