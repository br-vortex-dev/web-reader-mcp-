// Testes do modo cluster (WEB_CONCURRENCY).
//
// Contrato: sem a variavel, processo unico (comportamento de sempre). Com
// WEB_CONCURRENCY=N, o servico sobe N workers na mesma porta, todos atendendo,
// e o encerramento derruba tudo. E opt-in — nunca liga sozinho.
//
// Uso: node --test tests/cluster.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { freePort, startFixture, TOKEN, SERVER_PATH } from "./helpers.mjs";

let fixture;
test.before(async () => {
  fixture = await startFixture();
});
test.after(async () => {
  await fixture?.close();
});

async function esperarHealth(base, tentativas = 150) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return true;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function chamar(base, args) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "read_page", arguments: args },
    }),
  });
  const json = await res.json();
  return {
    isError: Boolean(json?.result?.isError),
    text: json?.result?.content?.[0]?.text || "",
  };
}

test("WEB_CONCURRENCY=2 sobe o cluster, atende e encerra", { timeout: 90000 }, async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER_PATH, "--http"], {
    env: {
      ...process.env,
      PORT: String(port),
      MCP_AUTH_TOKEN: TOKEN,
      ALLOW_PRIVATE_HOSTS: "1",
      TRUST_PROXY_HOPS: "0",
      WEB_CONCURRENCY: "2",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const base = `http://127.0.0.1:${port}`;
  try {
    const subiu = await esperarHealth(base);
    assert.ok(subiu, `o cluster nao subiu:\n${stderr}`);
    assert.match(stderr, /modo cluster: 2 workers/, `o banner do cluster deveria aparecer:\n${stderr}`);

    // As chamadas atendem de verdade (qualquer worker).
    for (let i = 0; i < 3; i++) {
      const r = await chamar(base, { url: `${fixture.url}/pagina`, maxChars: 500, timeoutMs: 15000 });
      assert.equal(r.isError, false, `chamada ${i} falhou: ${r.text.slice(0, 200)}`);
    }

    // Vários pedidos em paralelo: o cluster distribui e todos respondem.
    const paralelos = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        chamar(base, { url: `${fixture.url}/page/c${i}?kb=1`, maxChars: 300, timeoutMs: 15000 })
      )
    );
    assert.ok(
      paralelos.every((r) => !r.isError),
      `algum pedido falhou no cluster: ${paralelos.map((r) => r.isError).join(",")}`
    );
  } finally {
    child.kill();
  }

  // O processo tem de morrer (nada de worker pendurado segurando a porta).
  await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", resolve);
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 8000);
  });
});

test("sem WEB_CONCURRENCY o servidor continua processo unico", { timeout: 60000 }, async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER_PATH, "--http"], {
    env: {
      ...process.env,
      PORT: String(port),
      MCP_AUTH_TOKEN: TOKEN,
      ALLOW_PRIVATE_HOSTS: "1",
      WEB_CONCURRENCY: "",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    const subiu = await esperarHealth(base);
    assert.ok(subiu, `nao subiu:\n${stderr}`);
    assert.doesNotMatch(stderr, /modo cluster/, `nao deveria ter cluster:\n${stderr}`);
    const r = await chamar(base, { url: `${fixture.url}/pagina`, maxChars: 500, timeoutMs: 15000 });
    assert.equal(r.isError, false, r.text.slice(0, 200));
  } finally {
    child.kill();
  }
});
