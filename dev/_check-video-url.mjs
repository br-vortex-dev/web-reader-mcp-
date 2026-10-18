#!/usr/bin/env node
/**
 * _check-video-url.mjs — lê UM vídeo de verdade com o read_video e imprime
 * a saída completa (transcrição inclusa).
 *
 * Sobe o servidor de verdade (modo HTTP, produção — SSRF ligado) e chama
 * a ferramenta como uma IA chamaria.
 *
 * Uso: node dev/_check-video-url.mjs <url-do-video> [maxChars]
 */
import { startMcp } from "../tests/helpers.mjs";

const url = process.argv[2];
const maxChars = Number(process.argv[3]) || 12000;
if (!url) {
  console.error("uso: node dev/_check-video-url.mjs <url-do-video> [maxChars]");
  process.exit(1);
}

const mcp = await startMcp();
try {
  const t0 = Date.now();
  const r = await mcp.call("read_video", { url, maxChars, timeoutMs: 30000 });
  console.log(`url: ${url}`);
  console.log(`isError: ${r.isError} | ${Date.now() - t0} ms`);
  console.log("---------- saida ----------");
  console.log(r.text);
} finally {
  mcp.close();
}
