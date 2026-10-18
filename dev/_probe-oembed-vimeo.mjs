#!/usr/bin/env node
/**
 * _probe-oembed-vimeo.mjs — confere o endpoint oEmbed do Vimeo.
 * É o formato de dados que a leitura de vídeo usa em plataformas conhecidas.
 *
 * Uso: node dev/_probe-oembed-vimeo.mjs [url-do-video]
 */
import { fetchTextCached } from "../src/fetch.mjs";

const alvo = process.argv[2] || "https://vimeo.com/76979871";
const url = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(alvo)}`;
console.log(`GET ${url}`);
try {
  const r = await fetchTextCached(url, { timeoutMs: 15000 });
  console.log(`OK | content-type: ${r.contentType} | bytes: ${r.text.length}`);
  console.log(r.text.slice(0, 1500));
} catch (err) {
  console.log(`FALHOU: ${err.name}: ${err.message}`);
}
