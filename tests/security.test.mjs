// Testes de seguranca: SSRF (hosts privados e redirects) e rate limit.
//
// Uso: node --test tests/
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFixture, startMcp, sleep } from "./helpers.mjs";

const RATE_LIMIT_MAX = 60;

const URLS_PRIVADAS = [
  ["http://127.0.0.1/", "loopback IPv4"],
  ["http://localhost/", "hostname localhost"],
  ["http://0.0.0.0/", "0.0.0.0/8"],
  ["http://10.0.0.1/", "10/8"],
  ["http://172.16.5.4/", "172.16/12"],
  ["http://192.168.1.1/", "192.168/16"],
  ["http://100.64.0.1/", "100.64/10 (CGNAT)"],
  ["http://169.254.169.254/latest/meta-data/", "169.254/16 (metadata)"],
  ["http://224.0.0.1/", "224/4 (multicast)"],
  ["http://255.255.255.255/", "reservado"],
  ["http://[::1]/", "loopback IPv6"],
  ["http://[::]/", "IPv6 ::"],
  ["http://[fd00::1]/", "fc00::/7 (ULA)"],
  ["http://[fe80::1]/", "fe80::/10 (link-local)"],
  ["http://[::ffff:127.0.0.1]/", "IPv4 mapeado em IPv6"],
];

let fixture;
let mcpLocal; // ALLOW_PRIVATE_HOSTS=1 — para os testes que usam servidor local
let mcpBloqueando; // padrao de producao

before(async () => {
  fixture = await startFixture();
  mcpLocal = await startMcp({ ALLOW_PRIVATE_HOSTS: "1" });
  mcpBloqueando = await startMcp();
});

after(async () => {
  mcpLocal?.close();
  mcpBloqueando?.close();
  await fixture?.close();
});

/* ------------------------------- SSRF ---------------------------------- */

test("bloqueia hosts privados/internos (ALLOW_PRIVATE_HOSTS desligado)", { timeout: 60000 }, async () => {
  for (const [url, rotulo] of URLS_PRIVADAS) {
    const r = await mcpBloqueando.call("read_page", { url, maxChars: 300, timeoutMs: 3000 });
    assert.equal(r.isError, true, `deveria bloquear ${rotulo} (${url})`);
    assert.match(
      r.text,
      /Host bloqueado: endereço privado\/interno/,
      `mensagem inesperada para ${rotulo}: ${r.text}`
    );
  }
});

test("a guarda vale para todos os caminhos de saida, nao so read_page", { timeout: 60000 }, async () => {
  const privada = "http://127.0.0.1:4111/";
  const casos = [
    ["extract_links", { url: privada, timeoutMs: 3000 }],
    ["read_dynamic_page", { url: privada, timeoutMs: 3000 }],
    ["discover_urls", { url: privada, timeoutMs: 3000 }],
    ["read_multiple_pages", { urls: [privada], timeoutMs: 3000 }],
  ];
  for (const [nome, args] of casos) {
    const r = await mcpBloqueando.call(nome, args);
    assert.match(r.text, /Host bloqueado: endereço privado\/interno/, `${nome} deveria bloquear: ${r.text}`);
  }
  // crawl_site: a URL inicial bloqueada e ERRO (nao "0 paginas lidas"), para a
  // IA nao confundir site bloqueado com site vazio.
  const crawl = await mcpBloqueando.call("crawl_site", { url: privada, maxPages: 2, timeoutMs: 3000 });
  assert.equal(crawl.isError, true, `crawl_site deveria ser erro: ${crawl.text}`);
  assert.match(crawl.text, /Host bloqueado: endereço privado\/interno/, `crawl_site deveria citar o bloqueio: ${crawl.text}`);
});

test("ALLOW_PRIVATE_HOSTS=1 libera o host local (escape hatch de dev/testes)", { timeout: 30000 }, async () => {
  const r = await mcpLocal.call("read_page", { url: `${fixture.url}/pagina`, maxChars: 500 });
  assert.equal(r.isError, false, `deveria ler o fixture local: ${r.text}`);
  assert.match(r.text, /Fixture Parser/);
});

/* ----------------------------- redirects -------------------------------- */

test("segue redirects normais ate 5 saltos, resolvendo Location relativo", { timeout: 30000 }, async () => {
  const r = await mcpLocal.call("read_page", { url: `${fixture.url}/chain/3`, maxChars: 500 });
  assert.equal(r.isError, false, `deveria seguir 3 redirects: ${r.text}`);
  assert.match(r.text, /Fixture Parser/);
});

test("recusa cadeia de redirects acima de 5 saltos", { timeout: 30000 }, async () => {
  const r = await mcpLocal.call("read_page", { url: `${fixture.url}/chain/9`, maxChars: 500 });
  assert.equal(r.isError, true, "deveria recusar 9 saltos");
  assert.match(r.text, /Redirect inválido: excesso de saltos/);
});

test("recusa redirect para protocolo nao suportado", { timeout: 30000 }, async () => {
  const r = await mcpLocal.call("read_page", { url: `${fixture.url}/redirect-to-file`, maxChars: 500 });
  assert.equal(r.isError, true, "deveria recusar redirect para file:");
  assert.match(r.text, /Redirect inválido: protocolo não suportado/);
});

// Este e o unico caso que precisa de um host PUBLICO que redirecione para um IP
// interno (o alvo precisa ser publico para passar da primeira checagem e so
// entao esbarrar na revalidacao do salto). Sem internet, o teste e pulado.
test("redirect de host publico para IP interno e bloqueado", { timeout: 60000 }, async (t) => {
  const alvo = encodeURIComponent("http://127.0.0.1:9/");
  const url = `https://httpbin.org/redirect-to?url=${alvo}`;

  let disponivel = false;
  for (let tentativa = 0; tentativa < 2 && !disponivel; tentativa++) {
    try {
      const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10000) });
      disponivel = res.status >= 300 && res.status < 400 && Boolean(res.headers.get("location"));
    } catch {
      await sleep(500);
    }
  }
  if (!disponivel) {
    t.skip("httpbin.org indisponivel (sem internet): nao deu para testar o redirect publico");
    return;
  }

  const r = await mcpBloqueando.call("read_page", { url, maxChars: 300, timeoutMs: 20000 });
  assert.equal(r.isError, true, `deveria bloquear o salto para 127.0.0.1: ${r.text}`);
  assert.match(r.text, /Host bloqueado: endereço privado\/interno/);
});

/* ---------------------------- rate limit -------------------------------- */

// Dispara N requisicoes a /mcp usando o x-forwarded-for devolvido por xffDe(i).
async function martelar(mcp, xffDe, total = RATE_LIMIT_MAX + 5) {
  let ok = 0;
  let bloqueado = 0;
  for (let i = 0; i < total; i++) {
    const { status } = await mcp.raw(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { "x-forwarded-for": xffDe(i) }
    );
    if (status === 200) ok++;
    else if (status === 429) bloqueado++;
    else assert.fail(`status inesperado: ${status}`);
  }
  return { ok, bloqueado, total };
}

test("nao e burlavel rotacionando x-forwarded-for (TRUST_PROXY_HOPS=0)", { timeout: 60000 }, async () => {
  const mcp = await startMcp({ TRUST_PROXY_HOPS: "0" });
  try {
    const { ok, bloqueado } = await martelar(mcp, (i) => `10.0.0.${i}`);
    assert.equal(ok, RATE_LIMIT_MAX, "as primeiras 60 deveriam passar");
    assert.ok(bloqueado > 0, "rotacionar o x-forwarded-for nao pode escapar do limite");
  } finally {
    mcp.close();
  }
});

test("TRUST_PROXY_HOPS=1: forjar o lado ESQUERDO do x-forwarded-for nao burla", { timeout: 60000 }, async () => {
  const mcp = await startMcp({ TRUST_PROXY_HOPS: "1" });
  try {
    // As entradas da esquerda sao forjaveis; a direita (9.9.9.9) e a confiavel.
    const { ok, bloqueado } = await martelar(mcp, (i) => `10.1.1.${i}, 9.9.9.9`);
    assert.equal(ok, RATE_LIMIT_MAX, "as primeiras 60 deveriam passar");
    assert.ok(bloqueado > 0, "forjar a esquerda do x-forwarded-for nao pode escapar do limite");
  } finally {
    mcp.close();
  }
});

test("TRUST_PROXY_HOPS=1: o ultimo salto e o cliente (clientes distintos nao se afetam)", { timeout: 60000 }, async () => {
  const mcp = await startMcp({ TRUST_PROXY_HOPS: "1" });
  try {
    const { ok, bloqueado } = await martelar(mcp, (i) => `9.9.9.9, 10.2.2.${i}`);
    assert.equal(bloqueado, 0, "cada cliente real deveria ter o seu proprio contador");
    assert.equal(ok, RATE_LIMIT_MAX + 5);
  } finally {
    mcp.close();
  }
});

test("TRUST_PROXY_HOPS=1: x-forwarded-for invalido cai para o IP do socket", { timeout: 60000 }, async () => {
  const mcp = await startMcp({ TRUST_PROXY_HOPS: "1" });
  try {
    const { ok, bloqueado } = await martelar(mcp, (i) => `10.3.3.${i}, nao-e-ip`);
    assert.equal(ok, RATE_LIMIT_MAX, "com valor invalido o bucket e o IP do socket");
    assert.ok(bloqueado > 0, "valor invalido nao pode virar uma chave nova a cada requisicao");
  } finally {
    mcp.close();
  }
});

test("sem token, /mcp devolve 401", { timeout: 30000 }, async () => {
  const res = await fetch(`${mcpBloqueando.base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(res.status, 401);
});
