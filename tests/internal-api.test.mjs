// Testes da busca automatica de "APIs internas" que o read_page dispara
// sozinho quando o conteudo da pagina vem curto.
//
// O fixture registra em `probes` quais candidatos "/api/..." o servidor
// realmente buscou, o que deixa visivel o teto, o dedupe e a priorizacao.
//
// Uso: node --test tests/...
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startFixture, startMcp } from "./helpers.mjs";

let fixture;

before(async () => {
  fixture = await startFixture();
});

beforeEach(() => {
  fixture.clearProbes(); // o fixture e compartilhado entre os testes
});

after(async () => {
  await fixture?.close();
});

const paginaCom = (cands) => `${fixture.url}/api/pagina?cands=${encodeURIComponent(cands.join("|"))}`;

test("limita o numero de candidatos buscados (API_MAX_CANDIDATES)", { timeout: 60000 }, async () => {
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", API_MAX_CANDIDATES: "3" });
  try {
    const url = paginaCom([
      "/api/probe/um",
      "/api/probe/dois",
      "/api/probe/tres",
      "/api/probe/quatro",
      "/api/probe/cinco",
    ]);
    const r = await mcp.call("read_page", { url, maxChars: 4000, timeoutMs: 10000 });
    assert.equal(r.isError, false, r.text);
    assert.equal(fixture.probes.length, 3, `deveria buscar 3 candidatos, buscou: ${fixture.probes.join(", ")}`);
  } finally {
    mcp.close();
  }
});

test("deduplica candidatos repetidos", { timeout: 60000 }, async () => {
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", API_MAX_CANDIDATES: "3" });
  try {
    const url = paginaCom(["/api/probe/um", "/api/probe/um", "/api/probe/um"]);
    const r = await mcp.call("read_page", { url, maxChars: 4000, timeoutMs: 10000 });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(fixture.probes, ["um"], `deveria buscar 1 vez, buscou: ${fixture.probes.join(", ")}`);
  } finally {
    mcp.close();
  }
});

test("prioriza caminhos com cara de API e ignora asset estatico", { timeout: 60000 }, async () => {
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", API_MAX_CANDIDATES: "2" });
  try {
    // O .png aparece PRIMEIRO, mas pontua menos e nao pode ocupar vaga.
    const url = paginaCom([
      "/api/probe/estatico.png",
      "/api/probe/dados.json",
      "/api/probe/outro",
    ]);
    const r = await mcp.call("read_page", { url, maxChars: 4000, timeoutMs: 10000 });
    assert.equal(r.isError, false, r.text);
    assert.ok(
      !fixture.probes.includes("estatico.png"),
      `asset estatico nao deveria ser buscado: ${fixture.probes.join(", ")}`
    );
    assert.ok(
      fixture.probes.includes("dados.json"),
      `o candidato .json deveria ter prioridade: ${fixture.probes.join(", ")}`
    );
  } finally {
    mcp.close();
  }
});

test("respeita o orcamento TOTAL e nao estende o timeout do read_page", { timeout: 60000 }, async () => {
  const mcp = await startMcp({
    ALLOW_PRIVATE_HOSTS: "1",
    API_TOTAL_BUDGET_MS: "1500",
    API_MAX_CANDIDATES: "3",
  });
  try {
    // 3 candidatos que nunca respondem, com timeout de 5s cada: sem orcamento
    // seriam 15s; com o orcamento tem de parar em ~1,5s.
    const url = paginaCom(["/api/trava1", "/api/trava2", "/api/trava3"]);
    const t0 = Date.now();
    const r = await mcp.call("read_page", { url, maxChars: 2000, timeoutMs: 5000 });
    const segundos = (Date.now() - t0) / 1000;
    assert.equal(r.isError, false, `nao pode virar erro: ${r.text}`);
    assert.ok(segundos < 4, `deveria parar no orcamento (~1,5s), levou ${segundos.toFixed(1)}s`);
  } finally {
    mcp.close();
  }
});

test("devolve o que obteve antes de estourar o orcamento", { timeout: 60000 }, async () => {
  const mcp = await startMcp({
    ALLOW_PRIVATE_HOSTS: "1",
    API_TOTAL_BUDGET_MS: "2000",
    API_MAX_CANDIDATES: "3",
  });
  try {
    // O probe responde na hora; os dois /api/trava prendem ate o orcamento.
    const url = paginaCom(["/api/probe/bom", "/api/trava1", "/api/trava2"]);
    const t0 = Date.now();
    const r = await mcp.call("read_page", { url, maxChars: 4000, timeoutMs: 5000 });
    const segundos = (Date.now() - t0) / 1000;
    assert.equal(r.isError, false, r.text);
    assert.match(r.text, /valor/, "os dados do probe deveriam estar na saida");
    assert.match(r.text, /"nome":\s*"bom"|nome.*bom/, `saida inesperada: ${r.text}`);
    assert.ok(segundos < 4, `deveria parar no orcamento (~2s), levou ${segundos.toFixed(1)}s`);
  } finally {
    mcp.close();
  }
});

test("nao busca /api de host interno (bloqueio antes de qualquer candidato)", { timeout: 60000 }, async () => {
  // Com o bloqueio LIGADO, a propria pagina e interna: read_page tem de falhar
  // sem ter buscado nenhum candidato.
  const mcp = await startMcp();
  try {
    const url = paginaCom(["/api/probe/um", "/api/probe/dois"]);
    const r = await mcp.call("read_page", { url, maxChars: 2000, timeoutMs: 3000 });
    assert.equal(r.isError, true, `deveria ser bloqueado: ${r.text}`);
    assert.match(r.text, /Host bloqueado: endereço privado\/interno/);
    assert.deepEqual(fixture.probes, [], `nenhum candidato deveria ser buscado: ${fixture.probes.join(", ")}`);
  } finally {
    mcp.close();
  }
});

test("API_MAX_CANDIDATES=0 desliga a busca automatica", { timeout: 60000 }, async () => {
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", API_MAX_CANDIDATES: "0" });
  try {
    const url = paginaCom(["/api/probe/um"]);
    const r = await mcp.call("read_page", { url, maxChars: 2000, timeoutMs: 10000 });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(fixture.probes, [], "nao deveria buscar nada com o teto em 0");
  } finally {
    mcp.close();
  }
});
