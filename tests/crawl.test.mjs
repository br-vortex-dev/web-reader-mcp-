// Testes do relato de erro das ferramentas de varredura.
//
// Regra: falha nunca pode parecer "pagina vazia". Se a URL inicial nao puder
// ser lida, a ferramenta devolve isError. Se uma pagina do meio do crawl
// falhar, o crawl continua, mas o resumo diz que o resultado e parcial e
// agrupa os motivos.
//
// Uso: node --test tests/...
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { startFixture, startMcp, freePort, SERVER_PATH, TOKEN } from "./helpers.mjs";

let fixture;
let mcpBloqueando; // padrao de producao
let mcpLocal; // ALLOW_PRIVATE_HOSTS=1 (fixture local)

before(async () => {
  fixture = await startFixture();
  mcpBloqueando = await startMcp();
  mcpLocal = await startMcp({ ALLOW_PRIVATE_HOSTS: "1" });
});

after(async () => {
  mcpBloqueando?.close();
  mcpLocal?.close();
  await fixture?.close();
});

/* ----------------------- URL inicial bloqueada -------------------------- */

test("crawl_site com a URL inicial bloqueada devolve isError", { timeout: 60000 }, async () => {
  const r = await mcpBloqueando.call("crawl_site", { url: `${fixture.url}/`, maxPages: 3, timeoutMs: 3000 });
  assert.equal(r.isError, true, `crawl_site deveria ser erro: ${r.text}`);
  assert.match(r.text, /Não foi possível iniciar o crawl/);
  assert.match(r.text, /Host bloqueado: endereço privado\/interno/);
  assert.doesNotMatch(r.text, /0 paginas lidas/);
});

test("discover_urls com a URL inicial bloqueada devolve isError", { timeout: 60000 }, async () => {
  const r = await mcpBloqueando.call("discover_urls", { url: `${fixture.url}/`, limit: 5, timeoutMs: 3000 });
  assert.equal(r.isError, true, `discover_urls deveria ser erro: ${r.text}`);
  assert.match(r.text, /Host bloqueado: endereço privado\/interno/);
});

test("extract_links com a URL inicial bloqueada devolve isError", { timeout: 60000 }, async () => {
  const r = await mcpBloqueando.call("extract_links", { url: `${fixture.url}/`, timeoutMs: 3000 });
  assert.equal(r.isError, true, `extract_links deveria ser erro: ${r.text}`);
  assert.match(r.text, /Host bloqueado: endereço privado\/interno/);
});

test("crawl_site com erro de DNS devolve isError", { timeout: 60000 }, async () => {
  const r = await mcpBloqueando.call("crawl_site", {
    url: "https://dominio-que-nao-existe-mesmo.invalid/",
    maxPages: 2,
    timeoutMs: 5000,
  });
  assert.equal(r.isError, true, `deveria ser erro: ${r.text}`);
  assert.match(r.text, /Não foi possível iniciar o crawl/);
});

/* --------------------------- crawl parcial ------------------------------ */

test("crawl com falhas parciais continua e resume os motivos", { timeout: 60000 }, async () => {
  const r = await mcpLocal.call("crawl_site", {
    url: `${fixture.url}/crawl/start`,
    maxPages: 10,
    maxChars: 300,
    timeoutMs: 1500,
  });
  assert.equal(r.isError, false, `o crawl deveria concluir: ${r.text}`);

  const cabecalho = r.text.split("\n\n")[0];
  // 3 leem (start, ok1, ok2) e 3 falham (404, timeout, nao-HTML).
  assert.match(cabecalho, /3 pagina\(s\) lida\(s\)/, cabecalho);
  assert.match(cabecalho, /RESULTADO PARCIAL: 3 pagina\(s\) falharam/, cabecalho);
  assert.match(cabecalho, /1 com HTTP 404/, cabecalho);
  assert.match(cabecalho, /1 com timeout/, cabecalho);
  assert.match(cabecalho, /1 com conteúdo não-HTML/, cabecalho);

  // Cada falha isolada aparece rotulada, com a URL.
  assert.match(r.text, /# Erro ao ler .*\/crawl\/erro404/);
  assert.match(r.text, /# Erro ao ler .*\/crawl\/trava/);
  assert.match(r.text, /# Erro ao ler .*\/crawl\/naohtml/);

  // E as paginas que leem continuam no resultado.
  assert.match(r.text, /conteudo ok/);
});

test("crawl sem falhas nao fala em resultado parcial", { timeout: 60000 }, async () => {
  const r = await mcpLocal.call("crawl_site", {
    url: `${fixture.url}/crawl/ok1`,
    maxPages: 3,
    maxChars: 300,
    timeoutMs: 5000,
  });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Crawl de .*: 1 pagina\(s\) lida\(s\)/);
  assert.doesNotMatch(r.text, /RESULTADO PARCIAL/);
});

// O teto de paginas contava so as leituras BEM-SUCEDIDAS. Num site com muitos
// links quebrados, 10 links 404 com maxPages=4 baixavam os 10 — o teto nao
// limitava nada. Agora ele conta tentativas.
test("maxPages limita tentativas mesmo quando todas falham", { timeout: 60000 }, async () => {
  const r = await mcpLocal.call("crawl_site", {
    url: `${fixture.url}/crawl/so-erros`,
    maxPages: 4,
    maxChars: 300,
    timeoutMs: 5000,
  });
  assert.equal(r.isError, false, r.text);
  const cabecalho = r.text.split("\n\n")[0];
  // A pagina inicial le; sobram 3 tentativas para links, todas 404.
  assert.match(cabecalho, /1 pagina\(s\) lida\(s\)/, cabecalho);
  assert.match(cabecalho, /3 pagina\(s\) falharam/, cabecalho);
  assert.equal((r.text.match(/# Erro ao ler /g) || []).length, 3, r.text);
});

/* ----------------------- discover_urls: sitemap ------------------------- */

test("discover_urls decodifica &amp; e nao duplica <loc> repetido", { timeout: 60000 }, async () => {
  const r = await mcpLocal.call("discover_urls", { url: `${fixture.url}/`, limit: 10, timeoutMs: 5000 });
  assert.equal(r.isError, false, r.text);
  // 3 <loc>, sendo 1 repetido: o resultado tem 2 URLs.
  assert.match(r.text, /Encontradas 2 URLs/);
  assert.match(r.text, /https:\/\/exemplo\.org\/busca\?a=1&b=2/);
  assert.doesNotMatch(r.text, /&amp;/);
  assert.equal((r.text.match(/https:\/\/exemplo\.org\/duplicada/g) || []).length, 1, r.text);
});

/* --------------------- filtro de navegacao por segmento ---------------- */
// Os padroes de navegacao casavam contra a URL INTEIRA: /\/about/i filtrava
// /blog/about-cookies e a pagina de blog desaparecia do crawl.

test("filtro de navegacao casa por segmento, nao por substring da URL", { timeout: 60000 }, async () => {
  const r = await mcpLocal.call("crawl_site", {
    url: `${fixture.url}/nav/start`,
    maxPages: 6,
    maxChars: 300,
    timeoutMs: 5000,
  });
  assert.equal(r.isError, false, r.text);
  // segmento puro = descartado (nem entra na fila, nao gera falha)
  assert.doesNotMatch(r.text, /MARCADO-ABOUT-PURO/);
  // substring em segmento maior = TEM de ser lida
  assert.match(r.text, /MARCADO-ABOUT-COOKIES/, `about-cookies sumiu: ${r.text}`);
  // paginas normais e paginacao: /arquivo entra, /arquivo/page/2 nao
  assert.match(r.text, /MARCADO-ARQUIVO/);
  // 3 lidas (start, about-cookies, arquivo), nenhuma falha
  assert.match(r.text, /3 pagina\(s\) lida\(s\)/, r.text.slice(0, 200));
  assert.doesNotMatch(r.text, /RESULTADO PARCIAL/);
});

/* --------------------- read_multiple_pages (nao mudou) ------------------ */

test("read_multiple_pages rotula cada falha individual sem derrubar a chamada", { timeout: 60000 }, async () => {
  const r = await mcpBloqueando.call("read_multiple_pages", {
    urls: [`${fixture.url}/`, "https://example.invalid/", `${fixture.url}/outra`],
    maxChars: 100,
    timeoutMs: 3000,
  });
  // O isolamento por URL e o comportamento desejado: a chamada nao e erro.
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /0\/3 paginas OK/);
  // Mas cada falha aparece rotulada como erro.
  const marcadores = r.text.match(/# Erro ao ler /g) || [];
  assert.equal(marcadores.length, 3, `cada falha deveria estar rotulada: ${r.text}`);
  assert.match(r.text, /Host bloqueado: endereço privado\/interno/);
});

/* ------------- dedupe + teto de saida somada (read_multiple) ----------- */
// A mesma URL repetida 3x virava 3 fetches e 3 copias do texto; e nao havia
// teto para a soma das secoes (30 URLs x 50k = 1,5M caracteres).

test("read_multiple_pages deduplica URLs repetidas", { timeout: 90000 }, async () => {
  const r = await mcpLocal.call("read_multiple_pages", {
    urls: [
      `${fixture.url}/page/dedupe`,
      `${fixture.url}/`,
      `${fixture.url}/page/dedupe`,
      `${fixture.url}/page/dedupe`,
    ],
    maxChars: 4000,
  });
  assert.equal(r.isError, false, r.text);

  // 1 fetch so para a URL repetida: o fixture conta REQ-<id>-<n> no texto
  assert.equal((r.text.match(/REQ-dedupe-1/g) || []).length, 1, `conteudo repetido: ${r.text.slice(0, 400)}`);
  assert.doesNotMatch(r.text, /REQ-dedupe-2/);
  // as repeticoes viram marcador curto, nao o texto inteiro
  assert.equal((r.text.match(/URL repetida/g) || []).length, 2);
  // cabecalho conta 2 unicas de 4 pedidas
  assert.match(r.text, /Leitura concluida: 2\/2 paginas OK/);
  assert.match(r.text, /2 URL\(s\) repetida\(s\)/);
});

test("read_multiple_pages respeita o teto de saida total", { timeout: 90000 }, async () => {
  // MULTI_MAX_TOTAL_CHARS configuravel: com o valor baixo, o corte tem de
  // aparecer com a marcagem de truncamento e as secoes seguintes, omitidas.
  const port2 = await freePort();
  const filho2 = spawn(process.execPath, [SERVER_PATH, "--http"], {
    env: {
      ...process.env,
      PORT: String(port2),
      MCP_AUTH_TOKEN: TOKEN,
      ALLOW_PRIVATE_HOSTS: "1",
      TRUST_PROXY_HOPS: "0",
      MULTI_MAX_TOTAL_CHARS: "3000",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  filho2.stderr.on("data", () => {});
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port2}/health`)).ok) break;
    } catch {
      // subindo
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const call2 = async (name, args) => {
    const res = await fetch(`http://127.0.0.1:${port2}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    const json = await res.json();
    return { isError: Boolean(json?.result?.isError), text: json?.result?.content?.[0]?.text || "" };
  };
  try {
    // 3 paginas de ~4 KB cada: o teto de 3000 corta a 1a e omite as outras
    const r = await call2("read_multiple_pages", {
      urls: [`${fixture.url}/page/g1?kb=4`, `${fixture.url}/page/g2?kb=4`, `${fixture.url}/page/g3?kb=4`],
      maxChars: 50000,
    });
    assert.equal(r.isError, false, r.text);
    assert.match(r.text, /conteudo truncado/, `corte nao apareceu: ${r.text.slice(0, 300)}`);
    assert.match(r.text, /omitid/i, `aviso de omissao nao apareceu: ${r.text.slice(0, 300)}`);
    assert.doesNotMatch(r.text, /REQ-g3-1/, "a terceira pagina deveria estar omitida");
  } finally {
    filho2.kill();
  }
});
