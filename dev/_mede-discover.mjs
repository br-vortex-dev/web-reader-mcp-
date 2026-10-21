#!/usr/bin/env node
// Medição rápida do discover_urls contra um site real, para comparar o
// antes (1.454 ms no iana.org, sitemaps testados em série) e o depois.
import { performance } from "node:perf_hooks";
const { toolDiscoverUrls } = await import("../src/tools.mjs");

const url = process.argv[2] || "https://www.iana.org/help/example-domains";
const amostras = Math.max(1, Number(process.argv[3]) || 3);

// aquecimento opcional: "frio" (padrão) mede a primeira chamada de verdade,
// como a bateria de produção; "quente" aquece antes, como o cache do Render.
const aquecer = process.argv[4] !== "frio";
if (aquecer) await toolDiscoverUrls({ url, timeoutMs: 30000 }).catch(() => {});

const tempos = [];
for (let i = 0; i < amostras; i++) {
  const t = performance.now();
  const saida = await toolDiscoverUrls({ url, timeoutMs: 30000 });
  tempos.push(performance.now() - t);
  if (i === amostras - 1) console.log(saida.slice(0, 400));
}
const media = tempos.reduce((a, b) => a + b, 0) / tempos.length;
console.log(`\ndiscover_urls ${url}`);
console.log(`amostras: ${tempos.map((t) => `${t.toFixed(0)}ms`).join(" | ")}  → média ${media.toFixed(0)} ms`);
process.exit(0);
