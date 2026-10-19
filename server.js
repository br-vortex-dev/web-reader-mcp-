#!/usr/bin/env node
/**
 * web-reader-mcp — servidor MCP feito do zero.
 *
 * - Zero dependências (nenhum npm install necessário).
 * - Sem API key e sem scraping de buscador: a busca é feita pela IA,
 *   que passa as URLs para as ferramentas de leitura.
 * - Protocolo MCP (stdio, JSON-RPC newline-delimited) implementado à mão.
 * - Parser de HTML → markdown também implementado à mão (tokenizer próprio).
 *
 * Ferramentas (8):
 *   read_page(url)               -> lê uma página e devolve título + conteúdo em markdown
 *   extract_links(url)           -> lista os links de uma página
 *   read_multiple_pages(urls)    -> lê várias páginas por chamada
 *   read_dynamic_page(url)       -> lê páginas que dependem de JavaScript (sem Playwright)
 *   read_video(url)              -> lê vídeo (metadados + transcrição da legenda)
 *   read_pdf(url)                -> extrai o texto de um PDF (sem OCR)
 *   discover_urls(url)           -> descobre URLs do site (sitemap.xml ou links internos)
 *   crawl_site(url)              -> lê um site sozinho (BFS pelos links internos)
 */

import { SERVER_NAME, ALLOW_PRIVATE_HOSTS } from "./src/config.mjs";
import { startStdio, startHttp, encerrarPorErro } from "./src/server.mjs";

if (ALLOW_PRIVATE_HOSTS) {
  console.error(
    `[${SERVER_NAME}] AVISO: ALLOW_PRIVATE_HOSTS=1 — o bloqueio de hosts privados/internos está DESLIGADO (apenas uso local).`
  );
}

// Render define PORT -> modo HTTP. Local -> stdio. `--http` força HTTP, `--stdio` força stdio.
const FORCE_HTTP = process.argv.includes("--http");
const FORCE_STDIO = process.argv.includes("--stdio");
const HTTP_MODE = FORCE_HTTP || (!FORCE_STDIO && !!process.env.PORT);

// Exceção/rejeição não tratada = estado desconhecido. Política: LOGAR e MORRER.
process.on("uncaughtException", (err) => {
  console.error(`[${SERVER_NAME}] exceção não tratada:`, err);
  encerrarPorErro("exceção não tratada");
});
process.on("unhandledRejection", (err) => {
  console.error(`[${SERVER_NAME}] rejeição não tratada:`, err);
  encerrarPorErro("rejeição não tratada");
});

if (HTTP_MODE) {
  await startHttp();
} else {
  startStdio();
}
