#!/usr/bin/env node
/**
 * _probe-prazo.mjs — prova que o prazo final devolve o que já foi lido.
 *
 * COMO ESTE TESTE FOI CALIBRADO (duas tentativas anteriores não provavam nada)
 *
 *   1ª tentativa: 1 página de 3 s e prazo de 1,2 s. Voltou em 3 s e "passou"
 *   por engano — o piso de MAX_PRAZO_MULTI_MS (5 s) engoliu o valor pedido.
 *
 *   2ª tentativa: 1 página de 8 s. Voltou em 5 s, mas quem cortou foi o
 *   timeout DA LEITURA (timeoutMs=5000), não o prazo. Como o prazo é sempre
 *   >= o timeout de uma leitura, uma página sozinha NUNCA é cortada pelo
 *   prazo — e isso é de propósito: o prazo não pode abortar uma leitura que
 *   ainda está dentro do próprio tempo que o cliente autorizou.
 *
 *   O cenário em que o prazo existe de verdade é a SOMA: muitas páginas em
 *   fila, cada uma dentro do seu timeout, mas o total passando do orçamento.
 *   É o que este arquivo monta — HOST_MAX_CONCURRENCY=1 põe as leituras em
 *   série, 5 páginas de 500 ms somam 2,5 s, e o prazo de 1 s tem de cortar no
 *   meio entregando as primeiras.
 *
 * Rode com:
 *   ALLOW_PRIVATE_HOSTS=1 HOST_MAX_CONCURRENCY=1 PRAZO_MINIMO_MULTI_MS=1000
 */
import http from "node:http";
import { toolReadMultiplePages, toolCrawlSite } from "../src/tools.mjs";

const ATRASO_MS = 500;

const servidor = http.createServer((req, res) => {
  if (req.url === "/inicio") {
    // A raiz responde na hora (o crawl a lê fora do pool) e aponta para 5
    // páginas lentas, para o prazo ser exercitado no pool.
    const links = Array.from({ length: 5 }, (_, i) => `<a href="/lenta-${i}">l${i}</a>`).join(" ");
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<html><body><h1>inicio</h1><p>raiz do site</p>${links}</body></html>`);
    return;
  }
  setTimeout(() => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><body><h1>pagina</h1><p>" + "conteudo ".repeat(100) + "</p></body></html>");
  }, ATRASO_MS);
});

await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));
const porta = servidor.address().port;
const base = `http://127.0.0.1:${porta}`;

// ---------- 1. read_multiple_pages ----------
const urls = Array.from({ length: 5 }, (_, i) => `${base}/lenta-a${i}`);
const t0 = Date.now();
const saidaMulti = await toolReadMultiplePages({ urls, maxChars: 300, timeoutMs: 1000 });
const msMulti = Date.now() - t0;

const linhasMulti = saidaMulti.split("\n");
console.log("=== read_multiple_pages (5 paginas de " + ATRASO_MS + "ms em serie) ===");
console.log("ms:", msMulti);
console.log("sem o prazo seriam:", 5 * ATRASO_MS, "ms (soma das 5)");
console.log("voltou antes da soma:", msMulti < 5 * ATRASO_MS - 400 ? "SIM" : "NAO");
console.log("entregou paginas lidas:", saidaMulti.includes("# (sem título)") || saidaMulti.includes("pagina") ? "SIM" : "NAO");
console.log("aviso de nao lidas:", /nao chegaram a ser lidas/.test(saidaMulti) ? "SIM" : "NAO");
console.log("--- resumo ---");
console.log(linhasMulti[0]);

// ---------- 2. crawl_site ----------
const t1 = Date.now();
const saidaCrawl = await toolCrawlSite({
  url: `${base}/inicio`,
  maxPages: 6,
  maxChars: 300,
  timeoutMs: 1000,
});
const msCrawl = Date.now() - t1;

console.log("");
console.log("=== crawl_site (raiz + 5 lentas em serie) ===");
console.log("ms:", msCrawl);
console.log("cortou antes da soma:", msCrawl < 5 * ATRASO_MS - 400 ? "SIM" : "NAO");
console.log("avisou o prazo:", /PRAZO ENCERRADO/.test(saidaCrawl) ? "SIM" : "NAO");
console.log("--- cabecalho ---");
console.log(saidaCrawl.split("\n").slice(0, 3).join("\n"));

servidor.close();
process.exit(0);
