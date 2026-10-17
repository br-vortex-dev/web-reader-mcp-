#!/usr/bin/env node
/**
 * rajada.mjs — prova de rajada: o trabalho repetido não se multiplica.
 *
 * Simula "muita gente lendo os MESMOS sites ao mesmo tempo": N leitores
 * disparam read_multiple_pages com a MESMA lista de URLs, tudo em paralelo.
 * Mede o que o SITE vê (acessos por URL, contados no próprio fixture), o que
 * os leitores recebem (OK/falhas) e o tempo total.
 *
 * Roda contra o servidor ATUAL e, se existir, contra a cópia em dev/_baseline
 * (o "antes") — mesma carga, mesma máquina, mesma rede local.
 *
 * Uso:
 *   node dev/load/rajada.mjs                # compara atual × baseline
 *   node dev/load/rajada.mjs --so atual     # só o servidor atual
 */

import { spawn } from "node:child_process";
import http from "node:http";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(__dirname, "..", "..");
const SERVIDORES = {
  atual: join(RAIZ, "server.js"),
  baseline: join(RAIZ, "dev", "_baseline", "server.js"),
};
const TOKEN = "token-de-rajada";

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.on("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

// Fixture: uma página por URL (com atraso simulando site difícil) e um
// contador de acessos por caminho — é o que o "site de terceiro" enxerga.
async function startFixture(caminhos, { kb, ms }) {
  const acessos = new Map();
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://local");
    if (u.pathname === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: *\n");
      return;
    }
    if (!u.pathname.startsWith("/site/")) {
      res.writeHead(404);
      res.end("nao encontrado");
      return;
    }
    acessos.set(u.pathname, (acessos.get(u.pathname) || 0) + 1);
    const recheio = "x".repeat(Math.max(0, kb * 1024 - 200));
    setTimeout(() => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<!DOCTYPE html><html><head><title>${u.pathname}</title></head><body>` +
          `<h1>${u.pathname}</h1><p>${recheio}</p></body></html>`
      );
    }, ms);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return {
    urls: caminhos.map((c) => `http://127.0.0.1:${port}${c}`),
    acessos,
    total: () => [...acessos.values()].reduce((a, b) => a + b, 0),
    close: () => new Promise((r) => server.close(r)),
  };
}

async function startMcp(serverPath) {
  const port = await freePort();
  const child = spawn(process.execPath, [serverPath, "--http"], {
    env: {
      ...process.env,
      PORT: String(port),
      MCP_AUTH_TOKEN: TOKEN,
      ALLOW_PRIVATE_HOSTS: "1",
      TRUST_PROXY_HOPS: "0",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr += d;
  });
  const base = `http://127.0.0.1:${port}`;
  let subiu = false;
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) break;
    try {
      if ((await fetch(`${base}/health`)).ok) {
        subiu = true;
        break;
      }
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!subiu) {
    child.kill();
    throw new Error(`servidor nao subiu (${serverPath}):\n${stderr}`);
  }
  return { base, close: () => child.kill(), stderr: () => stderr };
}

// A rajada: N leitores chamando read_multiple_pages na MESMA lista, em paralelo.
async function rajada(mcp, urls, leitores) {
  const t0 = Date.now();
  const envios = Array.from({ length: leitores }, () =>
    fetch(`${mcp.base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "read_multiple_pages",
          arguments: { urls, maxChars: 400, timeoutMs: 30000 },
        },
      }),
    })
      .then((r) => r.json())
      .catch((e) => ({ transporte: e.message }))
  );
  const resultados = await Promise.all(envios);
  const ms = Date.now() - t0;

  let ok = 0;
  let falhas = 0;
  for (const json of resultados) {
    if (json.transporte) {
      falhas += urls.length;
      continue;
    }
    const text = json.result?.content?.[0]?.text || "";
    if (json.result?.isError) {
      falhas += urls.length;
      continue;
    }
    const m = text.match(/(\d+)\/(\d+) paginas OK/);
    if (m) {
      ok += Number(m[1]);
      falhas += Number(m[2]) - Number(m[1]);
    } else {
      falhas += urls.length;
    }
  }
  return { ms, ok, falhas, leituras: leitores * urls.length };
}

async function cenario(nome, { leitores, sites, kb, atraso }, servidores) {
  console.log(
    `\n=== ${nome}: ${leitores} leitores × ${sites} sites (paginas de ${kb} KB, resposta em ${atraso} ms) ===`
  );
  const caminhos = Array.from({ length: sites }, (_, i) => `/site/${i}`);
  for (const [rotulo, caminhoServidor] of servidores) {
    const fixture = await startFixture(caminhos, { kb, ms: atraso });
    const mcp = await startMcp(caminhoServidor);
    try {
      const r = await rajada(mcp, fixture.urls, leitores);
      const acessos = fixture.acessos;
      const distintos = [...acessos.keys()].filter((k) => acessos.get(k) > 0).length;
      const porSite = (fixture.total() / sites).toFixed(1);
      let saude = "";
      try {
        const h = await (await fetch(`${mcp.base}/health`)).text();
        const co = h.match(/coalescidas: (\d+)/);
        const rv = h.match(/revalidacoes: (\d+)/);
        const cv = h.match(/conversoes: (\d+) \(reaproveitadas (\d+)\)/);
        const partes = [
          co ? `coalescidas ${co[1]}` : null,
          rv ? `revalidacoes ${rv[1]}` : null,
          cv ? `conversoes ${cv[1]} (reapr. ${cv[2]})` : null,
        ].filter(Boolean);
        if (partes.length) saude = ` | ${partes.join(" · ")}`;
      } catch {
        // sem /health legível
      }
      console.log(
        `  ${rotulo.padEnd(9)} acessos ao site: ${String(fixture.total()).padStart(4)} ` +
          `(${porSite}/site, ${distintos} sites distintos) | ` +
          `leituras OK: ${r.ok}/${r.leituras} | falhas: ${r.falhas} | tempo: ${r.ms} ms${saude}`
      );
    } finally {
      mcp.close();
      await fixture.close();
    }
  }
}

async function main() {
  const arg = (nome) => {
    const i = process.argv.indexOf(nome);
    return i >= 0 ? process.argv[i + 1] : null;
  };
  const so = arg("--so");
  const servidores = so
    ? [[so, SERVIDORES[so]]]
    : Object.entries(SERVIDORES).filter(([, p]) => existsSync(p));
  if (servidores.length === 0) {
    console.error("nenhum servidor para testar (server.js e dev/_baseline/ ausentes?)");
    process.exit(1);
  }

  console.log("Prova de rajada — mesma carga contra cada servidor, nesta maquina.");
  await cenario("leve", { leitores: 8, sites: 12, kb: 6, atraso: 100 }, servidores);
  await cenario("rajada", { leitores: 48, sites: 20, kb: 6, atraso: 100 }, servidores);
  console.log(
    "\nLembrete honesto: o teto fisico de conexoes simultaneas da instancia nao muda -" +
      " \no que este teste mede e o desperdicio: quantas vezes o MESMO site e lido a toa."
  );
}

main().catch((err) => {
  console.error(`falhou: ${err.message}`);
  process.exit(1);
});
