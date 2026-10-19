// Chave canonica de URL: variacoes da MESMA pagina compartilham uma entrada.
//
// O que se quer garantir:
// - a URL com parametros de rastreio (utm_*, gclid, fbclid) acerta o cache da
//   URL limpa: um download so, mesmo contador REQ-<id>-N nas duas leituras;
// - a ORDEM dos parametros nao cria entradas diferentes;
// - o fragmento (#...) nao conta;
// - parametros que NAO sao de rastreio continuam distintos (sao paginas
//   diferentes de verdade: ?page=2 nao pode servir ?page=3).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFixture, startMcp, cacheInfo } from "./helpers.mjs";
import { chaveCanonica } from "../src/utils.mjs";

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

const reqDe = (texto, id) => {
  const m = texto.match(new RegExp(`REQ-${id}-(\\d+)`));
  assert.ok(m, `contador REQ-${id}-N nao apareceu na saida`);
  return Number(m[1]);
};

test("chaveCanonica: descarta rastreio, ordena os demais e tira fragmento", () => {
  assert.equal(
    chaveCanonica("https://exemplo.com/p?a=1&b=2&utm_source=x&gclid=abc"),
    chaveCanonica("https://exemplo.com/p?b=2&a=1")
  );
  assert.equal(chaveCanonica("https://exemplo.com/p#secao"), chaveCanonica("https://exemplo.com/p"));
  // Parametro real nao some.
  assert.notEqual(chaveCanonica("https://exemplo.com/p?page=2"), chaveCanonica("https://exemplo.com/p?page=3"));
  // URL invalida volta como veio, sem lancar.
  assert.equal(chaveCanonica("nao e url"), "nao e url");
});

test("URL com utm_* acerta o cache da URL limpa (um download so)", async () => {
  const limpa = `${fixture.url}/page/utm?kb=5`;
  const suja = `${limpa}&utm_source=newsletter&utm_medium=email&fbclid=xyz`;

  const r1 = await mcp.call("read_page", { url: limpa, maxChars: 300, timeoutMs: 20000 });
  assert.equal(reqDe(r1.text, "utm"), 1, "a primeira leitura baixa");

  const r2 = await mcp.call("read_page", { url: suja, maxChars: 300, timeoutMs: 20000 });
  assert.equal(
    reqDe(r2.text, "utm"),
    1,
    `a URL com rastreio deveria vir do cache (mesmo contador 1): ${r2.text.slice(0, 200)}`
  );

  const info = await cacheInfo(mcp);
  // Uma unica entrada para as duas URLs (mais o que os outros testes usaram;
  // aqui conferimos que as duas variacoes NAO viraram duas).
  const soUma = await mcp.call("read_page", { url: `${limpa}&gclid=zzz`, maxChars: 300, timeoutMs: 20000 });
  assert.equal(reqDe(soUma.text, "utm"), 1, "qualquer rastreio deveria acertar a mesma entrada");
  assert.ok(info.entries >= 1);
});

test("parametros reais continuam distintos (sem falso cache hit)", async () => {
  // O fixture marca a pagina so pelo id do caminho (/page/pag -> REQ-pag-N),
  // entao o contador e COMPARTILHADO pelas duas URLs. Se a chave canonica
  // tivesse colapsado page=2 e page=3 numa so, a segunda leitura viria do
  // cache (contador 1 outra vez); como sao paginas diferentes de verdade,
  // ela baixa e o contador avanca para 2.
  const p2 = `${fixture.url}/page/pag?kb=3&page=2`;
  const p3 = `${fixture.url}/page/pag?kb=3&page=3`;

  const r2 = await mcp.call("read_page", { url: p2, maxChars: 200, timeoutMs: 20000 });
  assert.equal(reqDe(r2.text, "pag"), 1);
  const r3 = await mcp.call("read_page", { url: p3, maxChars: 200, timeoutMs: 20000 });
  assert.equal(reqDe(r3.text, "pag"), 2, "page=3 e outra pagina e deveria ter baixado de novo");
  assert.notEqual(r2.text.split("\n")[1], r3.text.split("\n")[1], "as URLs finais devem diferir");
});
