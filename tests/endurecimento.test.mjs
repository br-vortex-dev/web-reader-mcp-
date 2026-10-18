// Testes do endurecimento da saída e das bordas de robustez (rodada de
// segurança): IP fixado no transporte (anti-DNS-rebinding de verdade),
// descompressão gzip/brotli, redirect e erro com corpo que nunca termina,
// robots.txt sem tocar host bloqueado, faixas de IP reservadas,
// percent-encoding malformado no crawl e teto do stdio.
//
// Uso: node --test tests/endurecimento.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { startFixture, startMcp, sleep, SERVER_PATH } from "./helpers.mjs";
import { httpGetUmSalto, coletarComTeto } from "../src/net.mjs";

let fixture;
let mcpLocal; // ALLOW_PRIVATE_HOSTS=1 — leituras no fixture local
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

/* ---------------- transporte: o IP validado é o que conecta -------------- */

test("transporte pinado: conecta no IP validado mesmo com o DNS do host quebrado", { timeout: 30000 }, async () => {
  const vistos = [];
  const server = http.createServer((req, res) => {
    vistos.push(req.headers.host);
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("PINADO-OK");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const host = `host-que-nao-resolve.invalid:${port}`;
  try {
    // COM o IP validado: o agent entrega a conexão ao 127.0.0.1, sem DNS.
    const r = await httpGetUmSalto(`http://${host}/pinado`, { ipValido: "127.0.0.1" });
    assert.equal(r.statusCode, 200);
    const corpo = await coletarComTeto(r.stream, { maxBytes: 1024 });
    assert.equal(corpo.toString(), "PINADO-OK");
    // O header Host preserva o nome de origem — virtual hosting continua funcionando.
    assert.equal(vistos[0], host, "o Host header deve preservar o hostname pedido");

    // SEM o IP: o DNS reprova — é a prova de que o pin é o que faz a conexão.
    await assert.rejects(
      httpGetUmSalto(`http://${host}/sem-pin`, {}),
      (err) => err.code === "ENOTFOUND",
      "sem o IP validado, o hostname que não resolve tem de falhar no DNS"
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

/* --------------------- descompressão na leitura ------------------------- */

test("gzip e brotli chegam descomprimidos", { timeout: 30000 }, async () => {
  for (const rota of ["/gzip", "/br"]) {
    const r = await mcpLocal.call("read_page", { url: `${fixture.url}${rota}`, maxChars: 4000 });
    assert.equal(r.isError, false, `${rota} deveria ler: ${r.text}`);
    assert.match(r.text, /MARCADO-COMPRIMIDA/, `${rota} devolveu conteudo errado: ${r.text.slice(0, 200)}`);
  }
});

/* --------------- corpos que nunca terminam não penduram ----------------- */

test("redirect com corpo que nunca termina não pendura o salto", { timeout: 30000 }, async () => {
  const t0 = Date.now();
  const r = await mcpLocal.call("read_page", { url: `${fixture.url}/redir-cuspe`, maxChars: 4000, timeoutMs: 5000 });
  const dt = Date.now() - t0;
  assert.equal(r.isError, false, `deveria seguir para /pagina: ${r.text}`);
  assert.match(r.text, /Fixture Parser/);
  assert.ok(dt < 8000, `não pode pendurar no corpo do redirect (levou ${dt} ms)`);
});

test("erro (404) com corpo que nunca termina devolve o erro na hora", { timeout: 30000 }, async () => {
  const t0 = Date.now();
  const r = await mcpLocal.call("read_page", { url: `${fixture.url}/erro-cuspe`, maxChars: 500, timeoutMs: 5000 });
  const dt = Date.now() - t0;
  assert.equal(r.isError, true, `deveria ser erro: ${r.text}`);
  assert.match(r.text, /HTTP 404/);
  assert.ok(dt < 8000, `não pode pendurar no corpo do erro (levou ${dt} ms)`);
});

/* ------------------- robots.txt vs host bloqueado ----------------------- */

test("com o host bloqueado, o robots.txt não é buscado", { timeout: 30000 }, async () => {
  // Fixture ISOLADO: o contador começa zerado e nada mais o toca.
  const isolado = await startFixture();
  const mcpBloq = await startMcp(); // bloqueio LIGADO
  try {
    const r = await mcpBloq.call("read_page", { url: `${isolado.url}/livre`, timeoutMs: 3000 });
    assert.equal(r.isError, true, `deveria bloquear: ${r.text}`);
    assert.match(r.text, /Host bloqueado/);
    // Dá tempo de qualquer requisição que ainda estivesse em voo aterrissar.
    await sleep(600);
    assert.equal(
      isolado.contagemDe("/robots.txt"),
      0,
      "o robots.txt não pode ser buscado quando o host está bloqueado (vazamento SSRF)"
    );
  } finally {
    mcpBloq.close();
    await isolado.close();
  }
});

/* --------------------- faixas reservadas de IP -------------------------- */

test("faixas reservadas/documentação continuam bloqueadas", { timeout: 60000 }, async () => {
  const alvos = [
    ["http://192.0.2.1/", "TEST-NET-1"],
    ["http://198.51.100.7/", "TEST-NET-2"],
    ["http://203.0.113.9/", "TEST-NET-3"],
    ["http://198.18.0.5/", "benchmark"],
    ["http://192.0.0.8/", "IETF"],
    ["http://[2001:db8::1]/", "documentacao IPv6"],
    ["http://[64:ff9b:1::5]/", "NAT64 local"],
  ];
  for (const [url, rotulo] of alvos) {
    const r = await mcpBloqueando.call("read_page", { url, maxChars: 300, timeoutMs: 3000 });
    assert.equal(r.isError, true, `${rotulo} deveria bloquear: ${r.text}`);
    assert.match(r.text, /Host bloqueado: endereço privado\/interno/, `${rotulo}: ${r.text}`);
  }
});

/* ------------------- percent-encoding malformado ------------------------ */

test("percent-encoding malformado no caminho não derruba o crawl", { timeout: 30000 }, async () => {
  // Antes: decodeURIComponent("/100%") lançava URIError e o crawl inteiro
  // morria ("Não foi possível iniciar o crawl") por causa de UM link.
  const r = await mcpLocal.call("crawl_site", {
    url: `${fixture.url}/porcento`,
    maxPages: 4,
    maxChars: 300,
    timeoutMs: 5000,
  });
  assert.equal(r.isError, false, `não pode quebrar com % malformado: ${r.text}`);
  assert.match(r.text, /pagina\(s\) lida\(s\)/);
});

/* ------------------------------ stdio ----------------------------------- */

test("stdio: linha acima do teto vira Parse error e o servidor continua", { timeout: 30000 }, async () => {
  const env = { ...process.env, STDIO_MAX_LINE_BYTES: "65536" };
  delete env.PORT; // sem PORT = modo stdio
  const child = spawn(process.execPath, [SERVER_PATH], { env, stdio: ["pipe", "pipe", "pipe"] });
  let saida = "";
  child.stdout.on("data", (d) => {
    saida += d.toString();
  });
  const esperarAte = async (cond, ms = 8000) => {
    const fim = Date.now() + ms;
    while (Date.now() < fim && !cond()) await sleep(50);
    return cond();
  };
  try {
    // Linha de 200 KB (o teto do teste é 64 KB) sem JSON nenhum.
    child.stdin.write("x".repeat(200 * 1024));
    child.stdin.write("\n");
    await esperarAte(() => /Parse error/.test(saida));
    assert.match(saida, /Parse error/, `esperava Parse error, veio: ${JSON.stringify(saida.slice(0, 200))}`);

    // E depois da gigante, uma mensagem válida continua sendo atendida.
    saida = "";
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
    await esperarAte(() => /"result"/.test(saida));
    assert.match(saida, /"result"/, `o servidor deveria continuar atendendo: ${JSON.stringify(saida.slice(0, 200))}`);
  } finally {
    child.kill();
  }
});
