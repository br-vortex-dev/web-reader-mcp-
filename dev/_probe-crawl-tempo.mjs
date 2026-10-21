#!/usr/bin/env node
/**
 * _probe-crawl-tempo.mjs — onde o tempo do crawl_site é gasto DEPOIS do prazo.
 *
 * O _probe-prazo.mjs mostrou que o crawl devolve o texto certo ("PRAZO
 * ENCERRADO") mas leva 2,8 s quando o prazo era 1 s. Antes de "consertar" no
 * chute, este arquivo mede: marca o instante de cada página lida e o instante
 * em que a chamada retorna, para saber se o atraso está no pool, no
 * fechamento das conexões ou na espera de algum trabalhador dormindo.
 */
import http from "node:http";

const ATRASO_MS = 500;
const inicio = Date.now();
const marca = (o) => console.log(`[${String(Date.now() - inicio).padStart(5)}ms] ${o}`);

const servidor = http.createServer((req, res) => {
  marca(`servidor recebeu ${req.url}`);
  if (req.url === "/inicio") {
    const links = Array.from({ length: 5 }, (_, i) => `<a href="/lenta-${i}">l${i}</a>`).join(" ");
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<html><body><h1>inicio</h1><p>raiz</p>${links}</body></html>`);
    return;
  }
  setTimeout(() => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><body><h1>pagina</h1><p>" + "conteudo ".repeat(100) + "</p></body></html>");
    marca(`servidor respondeu ${req.url}`);
  }, ATRASO_MS);
});

await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${servidor.address().port}`;

const { toolCrawlSite } = await import("../src/tools.mjs");

marca("chamando toolCrawlSite");
const saida = await toolCrawlSite({ url: `${base}/inicio`, maxPages: 6, maxChars: 300, timeoutMs: 1000 });
marca("toolCrawlSite RETORNOU");

console.log("---");
console.log(saida.split("\n").slice(0, 3).join("\n"));

servidor.close();
process.exit(0);
