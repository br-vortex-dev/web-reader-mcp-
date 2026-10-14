#!/usr/bin/env node
// Debug: ver o que o fetch retorna dos sites

const SITES = [
  "https://www.google.com",
  "https://pt.wikipedia.org/wiki/Brasil",
  "https://www.globo.com",
  "https://g1.globo.com",
];

for (const url of SITES) {
  console.log(`\n=== ${url} ===`);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(10000),
    });
    console.log(`Status: ${res.status}`);
    console.log(`Content-Type: ${res.headers.get("content-type")}`);
    console.log(`Content-Length: ${res.headers.get("content-length")}`);
    
    const text = await res.text();
    console.log(`Tamanho do HTML: ${text.length} chars`);
    console.log(`Primeiros 500 chars:`);
    console.log(text.slice(0, 500));
  } catch (e) {
    console.log(`Erro: ${e.message}`);
  }
}
