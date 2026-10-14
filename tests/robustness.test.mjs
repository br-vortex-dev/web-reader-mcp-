// Testes de robustez de borda: limite do corpo do POST, comparacao do token,
// Retry-After e encerramento limpo.
//
// Uso: node --test tests/...
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { startFixture, startMcp, freePort, SERVER_PATH, TOKEN } from "./helpers.mjs";

let fixture;
let mcp;

before(async () => {
  fixture = await startFixture();
  mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", MAX_BODY_BYTES: String(64 * 1024) });
});

after(async () => {
  mcp?.close();
  await fixture?.close();
});

/* ------------------------- corpo grande -> 413 -------------------------- */

test("corpo acima do limite devolve 413 (nao 400/Parse error)", { timeout: 60000 }, async () => {
  const grande = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: { recheio: "x".repeat(100 * 1024) },
  });
  assert.ok(grande.length > 64 * 1024, "o corpo do teste precisa passar do limite");

  const res = await fetch(`${mcp.base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: grande,
  });
  assert.equal(res.status, 413, `esperava 413, veio ${res.status}`);
  const json = await res.json();
  assert.equal(json.error.code, -32600);
  assert.match(json.error.message, /Corpo muito grande/);
});

test("corpo dentro do limite continua funcionando", { timeout: 60000 }, async () => {
  const res = await fetch(`${mcp.base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" }),
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal((json.result.tools || []).length, 6);
});

test("o servidor sobrevive a um corpo grande demais", { timeout: 60000 }, async () => {
  const grande = "x".repeat(200 * 1024);
  // Duas tentativas seguidas: se a conexao fosse destruida antes da resposta,
  // ou se o erro derrubasse o processo, a segunda falharia.
  for (let i = 0; i < 2; i++) {
    const res = await fetch(`${mcp.base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: grande,
    }).catch((err) => ({ status: 0, erro: err.message }));
    assert.equal(res.status, 413, `tentativa ${i + 1}: ${JSON.stringify(res)}`);
  }
  const health = await fetch(`${mcp.base}/health`);
  assert.equal(health.status, 200, "o servidor deveria continuar no ar");
});

/* --------------------- token com tamanho diferente --------------------- */

test("token de tamanho diferente devolve 401 sem lancar excecao", { timeout: 60000 }, async () => {
  const tokens = ["x", "", "a".repeat(5000), `${TOKEN}x`, TOKEN.slice(0, -1)];
  for (const token of tokens) {
    const res = await fetch(`${mcp.base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(res.status, 401, `token de ${token.length} bytes deveria dar 401, deu ${res.status}`);
    const json = await res.json();
    assert.equal(json.error.code, -32001);
  }
});

test("o token correto continua entrando", { timeout: 60000 }, async () => {
  const res = await fetch(`${mcp.base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(res.status, 200);
});

/* ------------------------------ Retry-After ---------------------------- */

test("respeita o Retry-After em segundos no retry de 429", { timeout: 60000 }, async () => {
  const url = `${fixture.url}/retry-after?segundos=2`;
  const t0 = Date.now();
  const r = await mcp.call("read_page", { url, maxChars: 500, timeoutMs: 15000 });
  const segundos = (Date.now() - t0) / 1000;
  assert.equal(r.isError, false, `deveria ter lido depois do retry: ${r.text}`);
  assert.match(r.text, /Depois do retry/);
  // O backoff padrao seria 400ms; respeitar o header significa esperar ~2s.
  assert.ok(segundos >= 1.9, `deveria esperar o Retry-After (~2s), esperou ${segundos.toFixed(2)}s`);
});

test("poe teto no Retry-After para nao ficar preso", { timeout: 90000 }, async () => {
  const url = `${fixture.url}/retry-after?segundos=9999`;
  const t0 = Date.now();
  const r = await mcp.call("read_page", { url, maxChars: 500, timeoutMs: 15000 });
  const segundos = (Date.now() - t0) / 1000;
  assert.equal(r.isError, false, `deveria ter lido depois do retry: ${r.text}`);
  assert.ok(segundos < 15, `Retry-After de 9999s nao pode ser obedecido: esperou ${segundos.toFixed(1)}s`);
  assert.ok(segundos >= 9, `deveria esperar o teto de 10s, esperou ${segundos.toFixed(1)}s`);
});

/* --------------------- request-line malformada -> 400 ------------------ */
// "GET http://[invalid HTTP/1.1" fazia new URL lancar dentro do handler
// async: rejeicao nao tratada, conexao morta sem resposta, processo vivo
// em estado desconhecido. Contrato atual: 400 limpo + servidor no ar.

test("request-line malformada devolve 400 e o servidor continua no ar", { timeout: 60000 }, async () => {
  const net = await import("node:net");
  const resposta = await new Promise((resolve) => {
    const s = net.connect(Number(new URL(mcp.base).port), "127.0.0.1", () => {
      s.write("GET http://[invalid HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    });
    let buf = "";
    s.on("data", (d) => { buf += d.toString(); });
    s.on("close", () => resolve(buf));
    s.on("error", () => resolve(buf));
    setTimeout(() => resolve(buf), 5000);
  });
  assert.match(resposta, /^HTTP\/1\.[01] 400/, `esperava 400 na resposta, veio: ${JSON.stringify(resposta.slice(0, 80))}`);
  assert.match(resposta, /Request-line invalida/);
  // sem rejeicao nao tratada no stderr
  const stderr = mcp.stderr();
  assert.doesNotMatch(stderr, /rejeicao nao tratada|excecao nao tratada/, `lixo no stderr:\n${stderr.slice(-400)}`);
  // e o servidor segue atendendo
  const health = await fetch(`${mcp.base}/health`);
  assert.equal(health.status, 200, "o servidor deveria continuar no ar");
});

/* --------------------------- encerramento limpo ------------------------ */

test(
  "SIGTERM encerra o servidor de forma limpa",
  { timeout: 60000, skip: process.platform === "win32" ? "no Windows um processo filho nao recebe SIGTERM (o handler nunca roda); o Render e Linux" : false },
  async () => {
    const port = await freePort();
    const child = spawn(process.execPath, [SERVER_PATH, "--http"], {
      env: { ...process.env, PORT: String(port), MCP_AUTH_TOKEN: TOKEN },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d;
    });

    let subiu = false;
    for (let i = 0; i < 80; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) {
          subiu = true;
          break;
        }
      } catch {
        // ainda subindo
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(subiu, `servidor nao subiu:\n${stderr}`);

    const saiu = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
    child.kill("SIGTERM");
    const resultado = await Promise.race([
      saiu,
      new Promise((r) => setTimeout(() => r({ code: "timeout" }), 15000)),
    ]);

    assert.notEqual(resultado.code, "timeout", "o processo deveria sair sozinho apos o SIGTERM");
    assert.equal(resultado.code, 0, `saida esperada 0, veio ${JSON.stringify(resultado)}`);
    assert.match(stderr, /SIGTERM recebido/);
    assert.match(stderr, /encerrado/);
  }
);
