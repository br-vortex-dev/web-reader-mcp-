// Revalidacao condicional do fetch (ETag/Last-Modified + 304).
//
// O que se quer garantir:
// - a primeira leitura baixa a pagina e guarda o ETag;
// - quando a entrada vence, o servidor manda If-None-Match; se o site
//   responder 304 (nao modificado), o download NAO acontece de novo e a
//   leitura continua devolvendo o mesmo conteudo;
// - o /health conta as tentativas e os 304 (observabilidade).
//
// O fixture /etag conta os hits e responde 304 quando o If-None-Match casa —
// e por esse contador que se prova que o corpo nao foi rebaixado.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFixture, startMcp } from "./helpers.mjs";

let fixture;
let mcp;

before(async () => {
  // TTL curto: a entrada vence logo e forcamos revalidacao sem esperar 7,5 min.
  fixture = await startFixture();
  mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", CACHE_TTL_MS: "700" });
});

after(async () => {
  mcp?.close();
  await fixture?.close();
});

test("revalidacao condicional: 304 reaquece a entrada sem baixar de novo", async () => {
  const url = `${fixture.url}/etag?tag="v1"`;

  const primeira = await mcp.call("read_page", { url });
  assert.equal(primeira.isError, false);
  assert.match(primeira.text, /Etag "v1"/);

  // Passa o TTL para a entrada vencer e a proxima leitura revalidar.
  await new Promise((r) => setTimeout(r, 900));

  const segunda = await mcp.call("read_page", { url });
  assert.equal(segunda.isError, false);
  // Mesmo conteudo: o payload guardado voltou a valer apos o 304.
  assert.match(segunda.text, /Etag "v1"/);

  // O /health tem de registrar a revalidacao e o 304.
  const health = await (await fetch(`${mcp.base}/health`)).text();
  const m = health.match(/condicional:\s*(\d+)\s*\(304\s*(\d+)\)/);
  assert.ok(m, `o /health deveria trazer os contadores condicional: ${health}`);
  assert.ok(Number(m[1]) >= 1, "deveria ter ao menos uma tentativa condicional");
  assert.ok(Number(m[2]) >= 1, "deveria ter ao menos um 304");
});

test("servidor sem ETag: cada vencimento volta a baixar (sem regressao)", async () => {
  const url = `${fixture.url}/page/sem-etag?kb=1`;
  const primeira = await mcp.call("read_page", { url });
  assert.equal(primeira.isError, false);
  assert.match(primeira.text, /REQ-sem-etag-1/);

  await new Promise((r) => setTimeout(r, 900));

  const segunda = await mcp.call("read_page", { url });
  assert.equal(segunda.isError, false);
  // Sem validador, o download tem de acontecer: o contador do fixture avanca.
  assert.match(segunda.text, /REQ-sem-etag-2/);
});
