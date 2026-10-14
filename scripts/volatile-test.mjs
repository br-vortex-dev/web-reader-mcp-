#!/usr/bin/env node
/**
 * volatile-test.mjs — testa o web-reader-mcp com dados que mudam todo dia.
 *
 * Diferente do smoke-test (que usa URLs estáticas como example.com), este teste
 * usa fontes voláteis: cotação de moedas, preço de cripto, notícias do dia e clima.
 * O objetivo é provar que o MCP consegue extrair conteúdo atualizado de sites reais.
 *
 * Uso: node scripts/volatile-test.mjs
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../server.js", import.meta.url));
const child = spawn(process.execPath, [serverPath], { stdio: ["pipe", "pipe", "inherit"] });

let buffer = "";
let nextId = 1;
const pending = new Map();
const failures = [];

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  }
});

child.on("exit", () => {
  for (const { reject } of pending.values()) {
    reject(new Error("servidor encerrou antes de responder"));
  }
  pending.clear();
});

function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout aguardando resposta de ${method}`));
    }, 60000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

function check(condition, label) {
  if (condition) {
    console.log(`  OK  ${label}`);
  } else {
    failures.push(label);
    console.log(`  FALHOU  ${label}`);
  }
}

function show(title, text, max = 600) {
  console.log(`\n----- ${title} -----`);
  console.log(text.length > max ? text.slice(0, max) + `\n... [${text.length} caracteres no total]` : text);
}

async function main() {
  console.log("=== TESTE DE DADOS VOLÁTEIS ===\n");
  console.log("Inicializando servidor MCP...");
  await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "volatile-test", version: "0.0.1" },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  // ============================================================
  // 1. COTAÇÃO DE MOEDAS — XE.com
  // ============================================================
  console.log("\n[1/5] Cotação de moedas (XE.com)");
  const xrates = await rpc("tools/call", {
    name: "read_page",
    arguments: { url: "https://www.xe.com/currencyconverter/convert/?Amount=1&From=USD&To=BRL", maxChars: 1500 },
  });
  const xratesText = (xrates.content || []).map((c) => c.text).join("\n");
  check(!xrates.isError, "XE.com: página carregou sem erro");
  check(xratesText.length > 100, `XE.com: conteúdo extraído (${xratesText.length} chars)`);
  check(/dólar|dolar|USD|BRL|real|euro/i.test(xratesText), "XE.com: menciona dólar ou real");
  show("XE.com - Câmbio", xratesText, 500);

  // ============================================================
  // 2. PREÇO DE CRIPTO — CoinMarketCap
  // ============================================================
  console.log("\n[2/5] Preço de cripto (CoinMarketCap)");
  const cripto = await rpc("tools/call", {
    name: "read_page",
    arguments: { url: "https://coinmarketcap.com/", maxChars: 2000 },
  });
  const criptoText = (cripto.content || []).map((c) => c.text).join("\n");
  check(!cripto.isError, "CoinMarketCap: página carregou sem erro");
  check(criptoText.length > 100, `CoinMarketCap: conteúdo extraído (${criptoText.length} chars)`);
  check(/bitcoin|ethereum|BTC|ETH|cripto/i.test(criptoText), "CoinMarketCap: menciona criptomoedas");
  show("CoinMarketCap - Cripto", criptoText, 500);

  // ============================================================
  // 3. NOTÍCIAS DO DIA — G1
  // ============================================================
  console.log("\n[3/5] Notícias do dia (G1)");
  const g1 = await rpc("tools/call", {
    name: "read_page",
    arguments: { url: "https://g1.globo.com/", maxChars: 2500 },
  });
  const g1Text = (g1.content || []).map((c) => c.text).join("\n");
  check(!g1.isError, "G1: página carregou sem erro");
  check(g1Text.length > 200, `G1: conteúdo extraído (${g1Text.length} chars)`);
  check(/Brasil|mundo|política|economia|saúde|esporte/i.test(g1Text), "G1: menciona seções de notícias");
  show("G1 - Notícias do dia", g1Text, 600);

  // ============================================================
  // 4. CLIMA — Climatempo
  // ============================================================
  console.log("\n[4/5] Clima (Climatempo)");
  const clima = await rpc("tools/call", {
    name: "read_page",
    arguments: { url: "https://www.climatempo.com.br/", maxChars: 1500 },
  });
  const climaText = (clima.content || []).map((c) => c.text).join("\n");
  check(!clima.isError, "Climatempo: página carregou sem erro");
  check(climaText.length > 100, `Climatempo: conteúdo extraído (${climaText.length} chars)`);
  check(/temperatura|clima|previsão|chuva|sol/i.test(climaText), "Climatempo: menciona dados de clima");
  show("Climatempo - Clima", climaText, 500);

  // ============================================================
  // 5. MÚLTIPLAS FONTES VOLÁTEIS — read_multiple_pages
  // ============================================================
  console.log("\n[5/5] Múltiplas fontes voláteis (read_multiple_pages)");
  const multi = await rpc("tools/call", {
    name: "read_multiple_pages",
    arguments: {
      urls: [
        "https://www.xe.com/currencyconverter/convert/?Amount=1&From=USD&To=BRL",
        "https://coinmarketcap.com/",
        "https://g1.globo.com/",
        "https://www.climatempo.com.br/",
      ],
      maxChars: 800,
    },
  });
  const multiText = (multi.content || []).map((c) => c.text).join("\n");
  check(!multi.isError, "Múltiplas: chamada sem erro");
  check(multiText.length > 500, `Múltiplas: conteúdo extraído (${multiText.length} chars)`);
  check(/4\/4 paginas OK/.test(multiText), "Múltiplas: 4/4 páginas lidas");
  show("Múltiplas fontes voláteis", multiText, 800);

  // ============================================================
  // RESULTADO FINAL
  // ============================================================
  console.log("\n" + "=".repeat(50));
  if (failures.length === 0) {
    console.log("RESULTADO: todos os testes de dados voláteis passaram.");
    console.log("O MCP consegue extrair conteúdo atualizado de fontes que mudam todo dia.");
  } else {
    console.log(`RESULTADO: ${failures.length} falha(s):`);
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("Erro no teste:", err.message);
    process.exitCode = 1;
  })
  .finally(() => {
    child.kill();
    setTimeout(() => process.exit(process.exitCode || 0), 200);
  });
