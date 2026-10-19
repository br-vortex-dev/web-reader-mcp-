// Compressao da resposta do /mcp (gzip/br/deflate conforme Accept-Encoding).
//
// O que se quer garantir:
// - cliente que pede gzip/br recebe content-encoding e um corpo que, ao
//   descomprimir, e IDENTICO ao JSON que veio sem compressao;
// - a resposta leva `vary: accept-encoding` (nenhum cache intermediario serve
//   a versao comprimida para quem nao aceita);
// - cliente que NAO declara Accept-Encoding continua recebendo JSON puro
//   (compatibilidade byte a byte com o comportamento de antes);
// - resposta pequena (abaixo do limiar) nao e comprimida (nao vale o custo).
//
// Usa http cru, nao fetch: o fetch do Node descomprime sozinho e esconderia
// justamente o header que queremos provar.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import zlib from "node:zlib";
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

// POST cru no /mcp: devolve status, headers e o corpo CRU (sem descomprimir).
function postCru(corpo, { acceptEncoding } = {}) {
  const { hostname, port } = new URL(mcp.base);
  return new Promise((resolve, reject) => {
    const headers = {
      "content-type": "application/json",
      authorization: "Bearer token-de-teste",
      "content-length": Buffer.byteLength(corpo),
    };
    if (acceptEncoding) headers["accept-encoding"] = acceptEncoding;
    const req = http.request({ hostname, port, method: "POST", path: "/mcp", headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, bruto: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end(corpo);
  });
}

// Descomprime o corpo conforme o content-encoding declarado.
function descomprimir(buffer, encoding) {
  if (encoding === "br") return zlib.brotliDecompressSync(buffer);
  if (encoding === "gzip") return zlib.gzip ? zlib.gunzipSync(buffer) : buffer;
  if (encoding === "deflate") return zlib.inflateSync(buffer);
  return buffer;
}

// Uma leitura de pagina grande o bastante para passar do limiar de compressao.
async function lerPaginaGrande() {
  const { text } = await mcp.call("read_page", { url: `${fixture.url}/page/grande?kb=20` });
  return text;
}

test("sem Accept-Encoding: resposta sai JSON puro, sem content-encoding", async () => {
  const corpo = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const r = await postCru(corpo);
  assert.equal(r.status, 200);
  assert.equal(r.headers["content-encoding"], undefined);
  assert.equal(r.headers["vary"], "accept-encoding");
  const json = JSON.parse(r.bruto.toString("utf8"));
  assert.ok(Array.isArray(json.result.tools));
});

test("gzip: corpo comprimido descomprime no JSON identico ao sem compressao", async () => {
  const chamada = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "read_page", arguments: { url: `${fixture.url}/page/gz?kb=20` } },
  });
  const semCompressao = await postCru(chamada);
  const comGzip = await postCru(chamada, { acceptEncoding: "gzip" });

  assert.equal(comGzip.status, 200);
  assert.equal(comGzip.headers["content-encoding"], "gzip");
  assert.equal(comGzip.headers["vary"], "accept-encoding");

  const descomprimido = descomprimir(comGzip.bruto, "gzip").toString("utf8");
  assert.equal(descomprimido, semCompressao.bruto.toString("utf8"));
  assert.ok(comGzip.bruto.length < semCompressao.bruto.length, "o corpo comprimido deve ser menor");
});

test("brotli tem prioridade sobre gzip quando o cliente aceita os dois", async () => {
  const chamada = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "read_page", arguments: { url: `${fixture.url}/page/br?kb=20` } },
  });
  const r = await postCru(chamada, { acceptEncoding: "gzip, deflate, br" });
  assert.equal(r.headers["content-encoding"], "br");
  const json = JSON.parse(descomprimir(r.bruto, "br").toString("utf8"));
  assert.ok(json.result.content[0].text.length > 1000);
});

test("resposta pequena (abaixo do limiar) nao e comprimida", async () => {
  // tools/call de ferramenta inexistente: a resposta e curta (só o isError),
  // logo abaixo do limiar de compressao.
  const chamada = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "nao_existe", arguments: {} },
  });
  const r = await postCru(chamada, { acceptEncoding: "gzip" });
  assert.ok(r.bruto.length < 1024, `corpo deveria ser pequeno, veio ${r.bruto.length} bytes`);
  assert.equal(r.headers["content-encoding"], undefined);
  assert.equal(r.headers["vary"], "accept-encoding");
});

test("q=0 desliga a codificacao: cliente que recusa gzip recebe JSON puro", async () => {
  const chamada = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "read_page", arguments: { url: `${fixture.url}/page/q0?kb=20` } },
  });
  const r = await postCru(chamada, { acceptEncoding: "gzip;q=0" });
  assert.equal(r.headers["content-encoding"], undefined);
});

test("a leitura grande realmente ganha bytes na volta (prova de ponta a ponta)", async () => {
  const chamada = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "read_page", arguments: { url: `${fixture.url}/page/ganho?kb=20` } },
  });
  const semCompressao = await postCru(chamada);
  const comBr = await postCru(chamada, { acceptEncoding: "br" });
  const reducao = 1 - comBr.bruto.length / semCompressao.bruto.length;
  // Num payload de 20 KB de texto, comprimir tem de cortar bem mais que 50%.
  assert.ok(reducao > 0.5, `reducao esperada > 50%, veio ${(reducao * 100).toFixed(1)}%`);
});
