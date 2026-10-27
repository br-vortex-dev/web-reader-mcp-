#!/usr/bin/env node
/**
 * _extremo-sites.mjs — os maiores documentos HTML publicos que existem,
 * medidos com CPU e memoria, nao so com relogio.
 *
 * Os alvos foram escolhidos por TAMANHO REAL medido agora (content-length):
 *   nodejs.org/api/all.html ......... 20,75 MB (perto do teto de documento 24 MB)
 *   html.spec.whatwg.org ............ 15,78 MB (pagina UNICA, nao a multipagina)
 *   tc39.es/ecma262 .................  7,64 MB
 *   Wikipedia/United_States ......... ~1,5 MB (controle de pagina comum grande)
 *
 * Para cada alvo:
 *   1. download cru (fetch global, sem o projeto) -> piso da rede;
 *   2. read_page (teto de 25.000 chars) -> caminho real do usuario;
 *   3. extract_links, find_on_page -> baixam o DOCUMENTO INTEIRO (teto 24 MB)
 *      e tokenizam tudo, sem parada antecipada: e o pior caso do parser.
 *
 * A CPU e medida com process.cpuUsage (rede parada nao conta). O pico de RSS
 * e amostrado a cada 10 ms. Rode com `node --expose-gc` para o GC entre casos
 * nao contaminar o pico do caso seguinte.
 *
 * Uso: node --expose-gc dev/_extremo-sites.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";

const { callTool } = await import("../src/tools.mjs");

const ALVOS = [
  {
    nome: "nodejs all.html",
    url: "https://nodejs.org/api/all.html",
    mb: "20,75 MB",
    ferramentas: ["read_page", "extract_links", "find_on_page"],
    query: "SIGKILL",
  },
  {
    nome: "whatwg spec (pagina unica)",
    url: "https://html.spec.whatwg.org/",
    mb: "15,78 MB",
    ferramentas: ["read_page", "extract_links", "find_on_page"],
    query: "getElementsByClassName",
  },
  {
    nome: "ecma262",
    url: "https://tc39.es/ecma262/",
    mb: "7,64 MB",
    ferramentas: ["read_page", "extract_links"],
  },
  {
    nome: "Wikipedia/United_States",
    url: "https://en.wikipedia.org/wiki/United_States",
    mb: "~1,5 MB",
    ferramentas: ["read_page"],
  },
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const mib = (b) => (b / 1024 / 1024).toFixed(1);
const ms = (n) => n.toFixed(0).padStart(6);
const mbTxt = (b) => (b / 1000 / 1000).toFixed(2).replace(".", ",");

/** Baixa a pagina inteira sem nenhuma camada do projeto. */
async function baixarCru(url) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, "accept-encoding": "gzip, br" },
      redirect: "follow",
      signal: AbortSignal.timeout(180000),
    });
    const buf = await res.arrayBuffer();
    return { ms: performance.now() - t0, bytes: buf.byteLength, status: res.status };
  } catch (e) {
    return { ms: performance.now() - t0, erro: e.message };
  }
}

/** Roda uma chamada medindo parede, CPU e pico de RSS. */
async function medir(fn) {
  if (global.gc) global.gc();
  const rssAntes = process.memoryUsage().rss;
  let rssPico = rssAntes;
  const timer = setInterval(() => {
    const r = process.memoryUsage().rss;
    if (r > rssPico) rssPico = r;
  }, 10);
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  let saida = "";
  let erro = "";
  try {
    saida = await fn();
  } catch (e) {
    erro = e.message;
  }
  const parede = performance.now() - t0;
  const d = process.cpuUsage(cpu0);
  clearInterval(timer);
  rssPico = Math.max(rssPico, process.memoryUsage().rss);
  return {
    parede,
    cpu: (d.user + d.system) / 1000,
    rssPico,
    rssDelta: rssPico - rssAntes,
    chars: saida.length,
    erro,
    saida,
  };
}

/** Resume a saida sem guardar o texto inteiro no relatorio. */
function resumir(saida) {
  const linhas = saida.split("\n");
  const conteudo = (saida.match(/Conteudo:\s*[\d.]+\+?(?: \(exibidos \d+\))?/) || [])[0] || "";
  const primeira = linhas[0] || "";
  const aviso = linhas.find((l) => /^(Aviso|AVISO|PRAZO|Erro)/.test(l)) || "";
  return { conteudo, primeira: primeira.slice(0, 160), aviso: aviso.slice(0, 200) };
}

const resultados = [];

function imprimir(rotulo, r) {
  if (r.erro) {
    console.log(`${rotulo.padEnd(26)} ${ms(r.parede)} ms  ERRO: ${r.erro.slice(0, 110)}`);
    return;
  }
  const res = resumir(r.saida);
  console.log(
    `${rotulo.padEnd(26)} ${ms(r.parede)} ms  cpu ${r.cpu.toFixed(0).padStart(5)} ms  ` +
      `rss ${mib(r.rssPico).padStart(6)} MB (+${mib(Math.max(0, r.rssDelta))})  ` +
      `${String(r.chars).padStart(6)} ch  ${res.conteudo || res.primeira}`
  );
  if (res.aviso) console.log(`${" ".repeat(28)}-> ${res.aviso}`);
}

console.log("=========================================================================================");
console.log("SITES MAIS PESADOS QUE EXISTEM — parede, CPU, pico de memoria");
console.log("=========================================================================================");

for (const alvo of ALVOS) {
  console.log(`\n## ${alvo.nome} — ${alvo.mb}`);
  const cru = await baixarCru(alvo.url);
  if (cru.erro) {
    console.log(`  download cru: ERRO ${cru.erro.slice(0, 120)}`);
  } else {
    console.log(
      `  download cru (pagina inteira): ${ms(cru.ms)} ms  ${mbTxt(cru.bytes)} MB ` +
        `(${mib(cru.bytes)} MiB)  HTTP ${cru.status}`
    );
  }

  const base = { alvo: alvo.nome, url: alvo.url, bytesReais: cru.bytes || 0, cruMs: cru.ms, cruErro: cru.erro || "" };

  if (alvo.ferramentas.includes("read_page")) {
    const r = await medir(() =>
      callTool("read_page", { url: alvo.url, maxChars: 25000, timeoutMs: 180000 })
    );
    imprimir("read_page (25k)", r);
    resultados.push({ ...base, ferramenta: "read_page", ...resumoNumerico(r) });
  }

  if (alvo.ferramentas.includes("extract_links")) {
    const r = await medir(() =>
      callTool("extract_links", { url: alvo.url, limit: 200, timeoutMs: 180000 })
    );
    imprimir("extract_links (200)", r);
    if (!r.erro) {
      const m = r.saida.match(/Links em .*: (\d+) encontrados/);
      console.log(`${" ".repeat(28)}-> ${m ? `${m[1]} links encontrados no documento inteiro` : resumir(r.saida).primeira}`);
    }
    resultados.push({ ...base, ferramenta: "extract_links", ...resumoNumerico(r) });
  }

  if (alvo.ferramentas.includes("find_on_page")) {
    const r = await medir(() =>
      callTool("find_on_page", {
        url: alvo.url,
        query: alvo.query,
        maxHits: 100,
        contexto: 5,
        timeoutMs: 180000,
      })
    );
    imprimir(`find_on_page "${alvo.query}"`, r);
    if (!r.erro) {
      const m = r.saida.match(/Ocorrencias: (\d+)/);
      console.log(
        `${" ".repeat(28)}-> ${m ? `${m[1]} ocorrencia(s)` : "NENHUMA"} ` +
          `(a busca cobre a pagina inteira quando a frente nao tem acerto)`
      );
    }
    resultados.push({ ...base, ferramenta: "find_on_page", ...resumoNumerico(r) });
  }
}

/* ---- chamadas de multiplicidade: o pior caso publico de uma so vez ---- */
console.log("\n## Chamadas de multiplicidade");
{
  const urls = ALVOS.filter((a) => a.nome !== "Wikipedia/United_States").map((a) => a.url);
  const r = await medir(() =>
    callTool("read_multiple_pages", { urls, maxChars: 25000, timeoutMs: 180000 })
  );
  imprimir(`read_multiple_pages (${urls.length} gigantes)`, r);
  resultados.push({ alvo: "3 gigantes", ferramenta: "read_multiple_pages", ...resumoNumerico(r) });
}

function resumoNumerico(r) {
  return {
    paredeMs: Math.round(r.parede),
    cpuMs: Math.round(r.cpu),
    rssPicoMiB: Number(mib(r.rssPico)),
    rssDeltaMiB: Number(mib(Math.max(0, r.rssDelta))),
    chars: r.chars,
    erro: r.erro || "",
    ...(r.erro ? {} : resumir(r.saida)),
  };
}

mkdirSync("dev/load", { recursive: true });
writeFileSync(
  "dev/load/extremo-sites.json",
  JSON.stringify({ quando: new Date().toISOString(), dispositivo: process.platform, resultados }, null, 2)
);
console.log("\ngravado: dev/load/extremo-sites.json");
