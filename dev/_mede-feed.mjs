#!/usr/bin/env node
/**
 * _mede-feed.mjs — mede o custo de CPU do analisarFeed (read_feed).
 *
 * Por que existe: o read_feed foi o MAIOR outlier da bateria de teto contra o
 * Render (20.446 ms, contra 1.302 ms do read_page na mesma rodada). Antes de
 * culpar a rede, é preciso saber quanto custa a INTERPRETAÇÃO do XML aqui —
 * se ela for quadrática no número de itens, o tempo cresce com o feed e não
 * com o servidor.
 *
 * Uso: node dev/_mede-feed.mjs [itens] [voltas]
 */
import { analisarFeed } from "../src/feeds.mjs";

const ITENS = Math.max(1, Number(process.argv[2] || 100));
const VOLTAS = Math.max(1, Number(process.argv[3] || 5));

/** Monta um feed RSS realista: 100 itens com resumo em CDATA. */
function montarFeed(itens) {
  const resumo = "x".repeat(600) + " <b>texto</b> com entidades &amp; e &ccedil; aqui. ";
  const linhas = ['<?xml version="1.0" encoding="UTF-8"?>', '<rss version="2.0"><channel>'];
  linhas.push("<title>Feed de teste</title>");
  linhas.push("<description>Feed sintético para medir CPU do parser</description>");
  for (let i = 0; i < itens; i++) {
    linhas.push("<item>");
    linhas.push(`<title>Item numero ${i} com um titulo de tamanho normal</title>`);
    linhas.push(`<link>https://exemplo.com/post/${i}</link>`);
    linhas.push(`<pubDate>Mon, 0${(i % 9) + 1} Oct 2026 12:00:00 GMT</pubDate>`);
    linhas.push(`<dc:creator>Autor ${i}</dc:creator>`);
    linhas.push(`<description><![CDATA[${resumo}]]></description>`);
    linhas.push("</item>");
  }
  linhas.push("</channel></rss>");
  return linhas.join("\n");
}

const xml = montarFeed(ITENS);
const mb = (Buffer.byteLength(xml, "utf8") / (1024 * 1024)).toFixed(2);

// Aquece o JIT.
analisarFeed(xml);

const tempos = [];
for (let v = 0; v < VOLTAS; v++) {
  const t0 = performance.now();
  const feed = analisarFeed(xml);
  const ms = performance.now() - t0;
  tempos.push(ms);
  if (v === 0) {
    console.log(`itens parseados: ${feed?.itens?.length ?? 0}`);
  }
}

const ordenado = [...tempos].sort((a, b) => a - b);
const mediana = ordenado[Math.floor(ordenado.length / 2)];
console.log(
  `feed ${mb} MB | ${ITENS} itens | ${VOLTAS} voltas | ` +
    `mediana ${mediana.toFixed(1)} ms | min ${ordenado[0].toFixed(1)} | max ${ordenado[ordenado.length - 1].toFixed(1)}`
);

// Prova de crescimento: se o custo por item subir junto com o número de itens,
// o parser é quadrático — e é isso que explica o outlier de 20 s.
const pequeno = montarFeed(Math.max(1, Math.floor(ITENS / 4)));
analisarFeed(pequeno);
const t1 = performance.now();
for (let i = 0; i < VOLTAS; i++) analisarFeed(pequeno);
const porItemPequeno = (performance.now() - t1) / VOLTAS / (ITENS / 4);
const porItemGrande = mediana / ITENS;
console.log(
  `custo por item: ${porItemPequeno.toFixed(3)} ms (1/4 do feed) -> ${porItemGrande.toFixed(3)} ms (feed cheio) ` +
    `| fator ${(porItemGrande / porItemPequeno).toFixed(2)}x`
);
