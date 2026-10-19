// Caracterizacao do transporte HTTP (startHttp).
//
// Este arquivo trava o CONTRATO do HTTP: ordem das verificacoes, status, headers
// e corpos. Ele passa no codigo ANTES da refactor e tem de continuar passando
// DEPOIS — se quebrar, a refactor mudou comportamento.
//
// Uso: node --test tests/http-transport.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { startFixture, freePort, SERVER_PATH } from "./helpers.mjs";

const TOKEN = "token-de-caracterizacao";

let fixture;
let child;
let base;
let port;

before(async () => {
  fixture = await startFixture();
  port = await freePort();
  child = spawn(process.execPath, [SERVER_PATH, "--http"], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      MCP_AUTH_TOKEN: TOKEN,
      ALLOW_PRIVATE_HOSTS: "1",
      TRUST_PROXY_HOPS: "0",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", () => {});
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch {
      // subindo
    }
    await new Promise((r) => setTimeout(r, 100));
  }
});

after(async () => {
  child?.kill();
  await fixture?.close();
});

// Bruto: devolve { status, headers, body } sem depender de content-type.
async function bruto(path, { method = "GET", headers = {}, body } = {}) {
  const res = await fetch(`${base}${path}`, { method, headers, body });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text };
}

test("404: path desconhecido responde 404 text/plain", async () => {
  const r = await bruto("/nao-existe");
  assert.equal(r.status, 404);
  assert.equal(r.headers.get("content-type"), "text/plain");
  assert.equal(r.body, "not found");
});

test("405: /mcp so aceita POST", async () => {
  const r = await bruto("/mcp", { method: "GET", headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(r.status, 405);
  assert.equal(r.headers.get("allow"), "POST");
  assert.equal(r.body, "Use POST /mcp com o JSON-RPC do MCP.");
});

test("401: sem token, /mcp devolve 401 com www-authenticate Bearer", async () => {
  const r = await bruto("/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(r.status, 401);
  assert.equal(r.headers.get("www-authenticate"), "Bearer");
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  const json = JSON.parse(r.body);
  assert.equal(json.error.code, -32001);
  assert.match(json.error.message, /Não autorizado/);
});

test("401: token errado tambem devolve 401", async () => {
  const r = await bruto("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer errado" },
    body: "{}",
  });
  assert.equal(r.status, 401);
});

test("OPTIONS: CORS com 204 e os headers certos", async () => {
  const r = await bruto("/mcp", { method: "OPTIONS" });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  assert.equal(r.headers.get("access-control-allow-methods"), "POST, GET, OPTIONS");
  assert.equal(r.headers.get("access-control-allow-headers"), "content-type, mcp-session-id, last-event-id, authorization");
});

test("/health: 200 text/plain com os campos", async () => {
  const r = await bruto("/health");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.match(r.body, /^web-reader-mcp v\d+\.\d+\.\d+ OK \| cache: /);
});

test("/: mesmo conteudo do /health", async () => {
  const r = await bruto("/");
  assert.equal(r.status, 200);
  assert.match(r.body, /web-reader-mcp v/);
});

test("400: request-line invalida responde 400 e o servidor segue no ar", async () => {
  const resposta = await new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => {
      s.write("GET http://[invalid HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    });
    let buf = "";
    s.on("data", (d) => (buf += d.toString()));
    s.on("close", () => resolve(buf));
    s.on("error", () => resolve(buf));
    setTimeout(() => resolve(buf), 5000);
  });
  assert.match(resposta, /^HTTP\/1\.[01] 400/);
  assert.match(resposta, /Request-line invalida/);
  const health = await bruto("/health");
  assert.equal(health.status, 200);
});

test("200: tools/list via POST /mcp com o token", async () => {
  const r = await bruto("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  const json = JSON.parse(r.body);
  assert.equal(json.result.tools.length, 10);
});

test("202: notificacao (sem id) nao gera resposta", async () => {
  const r = await bruto("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  assert.equal(r.status, 202);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  assert.equal(r.body, "");
});

test("400: corpo que nao e JSON devolve Parse error", async () => {
  const r = await bruto("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: "isso nao e json",
  });
  assert.equal(r.status, 400);
  const json = JSON.parse(r.body);
  assert.equal(json.error.code, -32700);
  assert.equal(json.error.message, "Parse error");
});

test("400: corpo vazio tambem e Parse error (JSON.parse de string vazia)", async () => {
  const r = await bruto("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: "",
  });
  assert.equal(r.status, 400);
});

test("400: tools/call com ferramenta desconhecida vira isError no resultado", async () => {
  const r = await bruto("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "nao_existe", arguments: {} } }),
  });
  assert.equal(r.status, 200);
  const json = JSON.parse(r.body);
  assert.equal(json.result.isError, true);
  assert.match(json.result.content[0].text, /Ferramenta desconhecida/);
});

test("batch: um array de mensagens devolve um array", async () => {
  const r = await bruto("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]),
  });
  assert.equal(r.status, 200);
  const json = JSON.parse(r.body);
  assert.ok(Array.isArray(json));
  assert.equal(json.length, 2);
});

// Cliente que abre o POST /mcp, manda só PARTE do corpo (dentro do
// content-length declarado) e morre. O servidor vê o fim da conexão sem "end".
function corpoTruncado(porta, contentLength) {
  return new Promise((resolve) => {
    const sock = net.connect(porta, "127.0.0.1", () => {
      sock.write(
        `POST /mcp HTTP/1.1\r\n` +
          `Host: 127.0.0.1:${porta}\r\n` +
          `Authorization: Bearer ${TOKEN}\r\n` +
          `Content-Type: application/json\r\n` +
          `Content-Length: ${contentLength}\r\n` +
          `\r\n` +
          `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{`
      );
      setTimeout(() => {
        sock.end(); // FIN educado, sem RST — o caso que pendurou o Render
        resolve();
      }, 120);
    });
    sock.on("error", () => resolve());
  });
}

// REGRESSÃO (produção): um cliente que morre no meio do corpo pendurava o
// handler no readBody (que só resolvia em "end" e só rejeitava em "error",
// nunca no abandono). A vaga de admissão nunca voltava: depois de MAX_INFLIGHT
// dessas, o servidor recusava tudo para sempre (visto no Render: 128 vagas
// presas por >100 min após uma rajada). Com a correção, o abandono libera a
// vaga e o servidor continua atendendo.
test("cliente que morre no meio do corpo nao prende a vaga de admissao", { timeout: 30000 }, async () => {
  const p = await freePort();
  const filho = spawn(process.execPath, [SERVER_PATH, "--http"], {
    env: {
      ...process.env,
      PORT: String(p),
      HOST: "127.0.0.1",
      MCP_AUTH_TOKEN: TOKEN,
      MAX_INFLIGHT_REQUESTS: "1", // uma vaga só: o vazamento aparece no 1º abandono
      MAX_WAITING_REQUESTS: "4",
      MAX_WAIT_MS: "800",
      TRUST_PROXY_HOPS: "0",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  filho.stderr.on("data", () => {});
  const b = `http://127.0.0.1:${p}`;
  try {
    let subiu = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${b}/health`)).ok) { subiu = true; break; } } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(subiu, "servidor auxiliar nao subiu");

    const lerAtivas = async () => {
      const t = await (await fetch(`${b}/health`)).text();
      return Number((t.match(/requisicoes: (\d+) ativas/) || [])[1]);
    };

    // 3 clientes abandonam o corpo: mais que as vagas disponíveis.
    await Promise.all([corpoTruncado(p, 100000), corpoTruncado(p, 100000), corpoTruncado(p, 100000)]);
    await new Promise((r) => setTimeout(r, 1500));

    assert.equal(await lerAtivas(), 0, "as vagas deveriam voltar a 0 depois dos abandonos");

    // E o servidor ainda atende um POST normal (a vaga nao ficou presa).
    const res = await fetch(`${b}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(res.status, 200, "o servidor deveria seguir atendendo apos os abandonos");
  } finally {
    filho.kill();
  }
});
