#!/usr/bin/env node
/**
 * Testa se o web-reader-mcp consegue ler páginas do YouTube.
 * Usa o modo stdio (protocolo nativo do MCP).
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, "..", "server.js");

const YOUTUBE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

async function testYouTube() {
  console.log("Iniciando servidor MCP em modo stdio...\n");
  
  const server = spawn("node", [serverPath, "--stdio"], {
    stdio: ["pipe", "pipe", "inherit"]
  });

  let buffer = "";
  let responseReceived = false;

  server.stdout.on("data", (data) => {
    buffer += data.toString();
    
    // Tenta processar mensagens JSON completas
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const msg = JSON.parse(line);
        if (msg.id === 1 && msg.result) {
          console.log("=== RESPOSTA DO MCP ===\n");
          console.log(JSON.stringify(msg.result, null, 2).substring(0, 3000));
          responseReceived = true;
          server.kill();
          process.exit(0);
        }
      } catch {
        // Linha incompleta, continua acumulando
      }
    }
  });

  server.on("error", (err) => {
    console.error("Erro ao iniciar servidor:", err.message);
    process.exit(1);
  });

  // Envia requisição para listar ferramentas
  const listTools = JSON.stringify({
    jsonrpc: "2.0",
    id: 0,
    method: "tools/list",
    params: {}
  }) + "\n";

  server.stdin.write(listTools);

  // Aguarda um pouco e depois envia a requisição para ler o YouTube
  setTimeout(() => {
    console.log(`Enviando requisição para ler: ${YOUTUBE_URL}\n`);
    
    const readPage = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "read_page",
        arguments: { url: YOUTUBE_URL }
      }
    }) + "\n";

    server.stdin.write(readPage);
  }, 1000);

  // Timeout de 30 segundos
  setTimeout(() => {
    if (!responseReceived) {
      console.log("TIMEOUT: MCP não respondeu em 30 segundos");
      server.kill();
      process.exit(1);
    }
  }, 30000);
}

testYouTube().catch(err => {
  console.error("Erro:", err);
  process.exit(1);
});
