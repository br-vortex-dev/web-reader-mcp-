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

test("405: metodo que nao e da spec (PUT) devolve 405", async () => {
  const r = await bruto("/mcp", { method: "PUT", headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(r.status, 405);
  assert.equal(r.headers.get("allow"), "POST");
  assert.equal(r.body, "Use POST /mcp com o JSON-RPC do MCP.");
});

test("GET /mcp com token mas sem sessao: 400 (canal SSE exige sessao)", async () => {
  const r = await bruto("/mcp", { method: "GET", headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(r.status, 400);
  const json = JSON.parse(r.body);
  assert.match(json.error.message, /[Ss]essao invalida/);
});

test("DELETE /mcp sem sessao: 400", async () => {
  const r = await bruto("/mcp", { method: "DELETE", headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(r.status, 400);
});

test("initialize emite Mcp-Session-Id e o DELETE encerra a sessao", async () => {
  const r = await bruto("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {} },
    }),
  });
  assert.equal(r.status, 200);
  const sid = r.headers.get("mcp-session-id");
  assert.ok(sid && sid.length > 10, "esperava um mcp-session-id na resposta do initialize");

  // DELETE com a sessão encerra (204).
  const del = await bruto("/mcp", {
    method: "DELETE",
    headers: { authorization: `Bearer ${TOKEN}`, "mcp-session-id": sid },
  });
  assert.equal(del.status, 204);

  // Encerrar de novo: a sessão não existe mais (404).
  const del2 = await bruto("/mcp", {
    method: "DELETE",
    headers: { authorization: `Bearer ${TOKEN}`, "mcp-session-id": sid },
  });
  assert.equal(del2.status, 404);
});

test("initialize reusa a sessao enviada pelo cliente", async () => {
  const r = await bruto("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, "mcp-session-id": "abc" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    }),
  });
  // A sessão "abc" não existia; o servidor emite uma nova (não a inventada).
  assert.equal(r.status, 200);
  const sid = r.headers.get("mcp-session-id");
  assert.ok(sid && sid !== "abc", "sessao inexistente nao deve ser ecoada");
});

test("initialize com versao desconhecida responde a mais nova suportada", async () => {
  const r = await bruto("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 71,
      method: "initialize",
      params: { protocolVersion: "1999-01-01" },
    }),
  });
  assert.equal(r.status, 200);
  const json = JSON.parse(r.body);
  assert.equal(json.result.protocolVersion, "2025-11-25");
});

test("initialize aceita a versao 2025-11-25 quando pedida", async () => {
  const r = await bruto("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 72,
      method: "initialize",
      params: { protocolVersion: "2025-11-25" },
    }),
  });
  assert.equal(r.status, 200);
  const json = JSON.parse(r.body);
  assert.equal(json.result.protocolVersion, "2025-11-25");
});

test("initialize sem id (notificacao) nao gera resposta", async () => {
  const r = await bruto("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", params: {} }),
  });
  assert.equal(r.status, 202);
  assert.equal(r.body, "");
});

test("mensagem JSON que nao e objeto devolve -32600 com id null", async () => {
  const r = await bruto("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: "42",
  });
  assert.equal(r.status, 200);
  const json = JSON.parse(r.body);
  assert.equal(json.id, null);
  assert.equal(json.error.code, -32600);
});

// Sem teto, UMA sessao valida abria conexoes SSE sem limite ate esgotar os
// descritores do processo (e os POSTs param junto).
test("SSE: no maximo 4 canais por sessao (5o recebe 429)", { timeout: 30000 }, async () => {
  const init = await bruto("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 72,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    }),
  });
  const sid = init.headers.get("mcp-session-id");
  assert.ok(sid, "initialize deveria emitir sessao");

  const abrirCanal = () =>
    new Promise((resolve) => {
      const sock = net.connect(port, "127.0.0.1", () => {
        sock.write(
          `GET /mcp HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
            `Authorization: Bearer ${TOKEN}\r\nMcp-Session-Id: ${sid}\r\n` +
            `Accept: text/event-stream\r\n\r\n`
        );
      });
      let buf = "";
      let encerrado = false;
      const concluir = () => {
        if (encerrado) return true;
        const status = Number((buf.match(/^HTTP\/1\.[01] (\d+)/) || [])[1]);
        if (!status) return false;
        // 200 e um stream aberto: resolve nos cabecalhos.
        encerrado = true;
        clearTimeout(timer);
        resolve({ sock, status, buf });
        return true;
      };
      sock.on("data", (d) => {
        buf += d.toString();
        concluir();
      });
      sock.on("error", () => {
        if (!encerrado) {
          encerrado = true;
          resolve({ sock, status: 0, buf });
        }
      });
      const timer = setTimeout(() => {
        if (!concluir()) {
          encerrado = true;
          sock.destroy();
          resolve({ sock, status: 0, buf });
        }
      }, 5000);
    });

  const canais = [];
  try {
    for (let i = 0; i < 4; i++) {
      const canal = await abrirCanal();
      assert.equal(canal.status, 200, `canal ${i + 1} deveria abrir: ${canal.buf.slice(0, 120)}`);
      canais.push(canal.sock);
    }
    // O 5o canal recebe 429 e a resposta FECHA, entao fetch resolve normalmente;
    // se o teto nao existisse, este fetch ficaria pendurado no stream aberto.
    const quinto = await fetch(`${base}/mcp`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "mcp-session-id": sid,
        accept: "text/event-stream",
      },
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(quinto.status, 429, "5o canal deveria ser recusado");
    assert.match(await quinto.text(), /Limite de 4 canais SSE/);
  } finally {
    for (const sock of canais) sock.destroy();
  }
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
  assert.equal(r.headers.get("access-control-allow-methods"), "POST, GET, DELETE, OPTIONS");
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
  assert.equal(json.result.tools.length, 12);
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

// CONCORRENCIA (o sintoma relatado em producao): varios tools/list ao mesmo
// tempo. A resposta e a MESMA constante de ~6,5 KB para todo mundo, entao o
// risco nao e o tamanho, e sim a resposta se misturar: um pedido receber o
// corpo do outro (id trocado) ou o cliente receber menos ferramentas. Aqui os
// 12 pedidos saem juntos e cada um tem de voltar com o SEU id e as 12.
test("concorrencia: 12 tools/list simultaneos nao trocam id nem truncam", { timeout: 30000 }, async () => {
  const respostas = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      fetch(`${base}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1000 + i, method: "tools/list" }),
      }).then(async (res) => ({ status: res.status, json: JSON.parse(await res.text()) }))
    )
  );
  respostas.forEach((r, i) => {
    assert.equal(r.status, 200, "nenhum tools/list pode falhar por estar concorrendo");
    assert.equal(r.json.id, 1000 + i, "cada resposta leva o id do seu proprio pedido");
    assert.equal(r.json.result.tools.length, 12, "a lista vem inteira, sem truncar");
  });
});

// CONCORRENCIA com a admissao apertada: 2 vagas e 16 pedidos de uma vez. O que
// nao cabe na vaga espera na fila e atende depois — tools/list e barato, entao
// nenhum pode ser recusado com 503 enquanto a fila tem espaco.
test("concorrencia: fila de admissao atende 16 tools/list com 2 vagas", { timeout: 60000 }, async () => {
  const p = await freePort();
  const filho = spawn(process.execPath, [SERVER_PATH, "--http"], {
    env: {
      ...process.env,
      PORT: String(p),
      HOST: "127.0.0.1",
      MCP_AUTH_TOKEN: TOKEN,
      MAX_INFLIGHT_REQUESTS: "2",
      MAX_WAITING_REQUESTS: "64",
      MAX_WAIT_MS: "8000",
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

    const respostas = await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        fetch(`${b}/mcp`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
          body: JSON.stringify({ jsonrpc: "2.0", id: 50 + i, method: "tools/list" }),
        }).then(async (res) => ({ status: res.status, json: JSON.parse(await res.text()) }))
      )
    );
    respostas.forEach((r, i) => {
      assert.equal(r.status, 200, "quem espera na fila e atendido, nao recusado");
      assert.equal(r.json.id, 50 + i);
      assert.equal(r.json.result.tools.length, 12);
    });
  } finally {
    filho.kill();
  }
});
