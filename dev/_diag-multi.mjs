#!/usr/bin/env node
/**
 * _diag-multi.mjs — POR QUE o read_multiple_pages perde páginas?
 *
 * O teste de carga só contou "96/160 páginas OK". Isso não diz nada: 40% de
 * perda pode ser site que bloqueia IP de datacenter (não é nosso), robots
 * (é política) ou bug nosso. Este script chama read_multiple_pages com os
 * MESMOS 20 sites do benchmark e classifica CADA falha em:
 *
 *   - robots      : bloqueado por robots.txt
 *   - http_4xx    : o site recusou (403/404/429...) — fora do nosso controle
 *   - timeout     : estourou o tempo
 *   - rede        : TLS/DNS/conexão
 *   - vazio       : leu (2xx) mas veio sem conteúdo — provável SPA/JS
 *   - ok          : entregou conteúdo
 *
 * Uso: node dev/_diag-multi.mjs <url-base> <token> [local]
 *   local = sobe o próprio servidor em vez de chamar o Render.
 */
import http from "node:http";
import https from "node:https";
import { spawn } from "node:child_process";

const BASE = process.argv[2] || "https://web-reader-mcp-13z0.onrender.com";
const TOKEN = process.argv[3] || "";
const LOCAL = process.argv[4] === "local";

const SITES20 = [
  "https://example.com",
  "https://httpbin.org/html",
  "https://jsonplaceholder.typicode.com",
  "https://www.wikipedia.org",
  "https://news.ycombinator.com",
  "https://github.com",
  "https://stackoverflow.com",
  "https://www.npmjs.com",
  "https://developer.mozilla.org",
  "https://nodejs.org",
  "https://www.google.com",
  "https://www.bbc.com",
  "https://www.cnn.com",
  "https://www.reddit.com",
  "https://www.medium.com",
  "https://www.linkedin.com",
  "https://www.twitter.com",
  "https://www.instagram.com",
  "https://www.facebook.com",
  "https://www.apple.com",
];

/** Classifica o motivo a partir da linha de erro que o multi devolve. */
function classificar(bloco) {
  const t = bloco.toLowerCase();
  if (/robots\.txt|robots_bloqueado|disallow/.test(t)) return "robots";
  if (/http 4\d\d|não é html.*http|403|429|404/.test(t)) return "http_4xx";
  if (/timeout após|timeout/.test(t)) return "timeout";
  if (/certificado|ssl|tls|enotfound|econnrefused|econnreset|rede|fetch failed/.test(t)) return "rede";
  return "outro";
}

async function chamarMulti(base, token) {
  const u = new URL(base + "/mcp");
  const lib = u.protocol === "https:" ? https : http;
  const corpo = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "read_multiple_pages",
      arguments: { urls: SITES20, maxChars: 8000, timeoutMs: 12000 },
    },
  });
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        method: "POST",
        path: "/mcp",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          "content-length": Buffer.byteLength(corpo),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const texto = Buffer.concat(chunks).toString("utf8");
          try {
            const json = JSON.parse(texto);
            resolve(json.result?.content?.[0]?.text ?? texto);
          } catch {
            resolve(texto);
          }
        });
      }
    );
    req.on("error", reject);
    req.end(corpo);
  });
}

async function main() {
  let base = BASE;
  let token = TOKEN;
  let filho = null;

  if (LOCAL) {
    const porta = 8907;
    filho = spawn(
      process.execPath,
      ["server.js", "--http"],
      {
        env: { ...process.env, MCP_AUTH_TOKEN: "t", PORT: String(porta), ALLOW_PRIVATE_HOSTS: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    filho.stdout.on("data", (d) => process.stdout.write("[svr] " + d));
    filho.stderr.on("data", (d) => process.stdout.write("[svr] " + d));
    base = `http://127.0.0.1:${porta}`;
    token = "t";
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log(`alvo: ${base}`);
  console.log(`sites: ${SITES20.length}\n`);

  const saida = await chamarMulti(base, token);
  const resumoLinha = (saida.match(/Leitura concluida:.*/) || ["(sem resumo)"])[0];
  console.log(resumoLinha + "\n");

  // Cada seção vem separada por uma linha de "===="; a que falhou começa com
  // "# Erro ao ler <url>".
  const secoes = saida.split(/\n=+\n/);
  const porSite = [];
  for (const s of secoes) {
    const m = s.match(/# Erro ao ler (\S+)\n([^\n]*)/);
    if (m) {
      porSite.push({ url: m[1], motivo: classificar(s), detalhe: m[2].slice(0, 90) });
    }
  }

  const contagem = {};
  for (const f of porSite) contagem[f.motivo] = (contagem[f.motivo] || 0) + 1;
  const ok = SITES20.length - porSite.length;

  console.log("=== FALHAS POR MOTIVO ===");
  console.log(`ok        ${ok}`);
  for (const [k, v] of Object.entries(contagem).sort((a, b) => b[1] - a[1])) {
    console.log(`${k.padEnd(9)} ${v}`);
  }

  console.log("\n=== DETALHE POR SITE ===");
  for (const f of porSite) {
    console.log(`${f.motivo.padEnd(9)} ${f.url}\n          ${f.detalhe}`);
  }

  if (filho) filho.kill();
}

main().catch((e) => {
  console.error("falhou:", e.message);
  process.exit(1);
});
