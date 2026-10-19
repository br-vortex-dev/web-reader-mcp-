#!/usr/bin/env node
/**
 * _check-search-live.mjs — prova LOCAL do read_search contra a web real.
 *
 * Sobe o servidor de verdade (modo HTTP, produção — bloqueio de hosts
 * privados LIGADO) e chama a busca como uma IA chamaria. Prova o ciclo
 * completo que faltava no MCP: BUSCAR -> LER.
 *
 * Contexto medido (dev/_probe-search*.mjs): do Render (IP de datacenter)
 * NENHUM buscador responde; da máquina local o DuckDuckGo HTML volta em
 * menos de 1 s. Este check roda local e por isso é o cenário onde a busca
 * sem chave funciona.
 *
 * Uso: node dev/_check-search-live.mjs
 */
import { startMcp } from "../tests/helpers.mjs";

let pass = 0;
let fail = 0;
const check = (cond, rotulo, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${rotulo}${extra ? "  ->  " + extra : ""}`);
  if (cond) pass++;
  else fail++;
};

const mcp = await startMcp();

try {
  // ---------- 1. Busca devolve resultados com título e URL ----------
  let primeiraUrl = "";
  {
    const r = await mcp.call("read_search", { q: "Node.js documentação oficial", limit: 5, timeoutMs: 20000 });
    const t = r.text;
    check(!r.isError, "busca: chamada sem erro de transporte", r.isError ? t.slice(0, 160) : "");
    check(/^# Busca:/.test(t), "busca: cabeçalho presente");
    check(/Provedor: DuckDuckGo HTML/.test(t), "busca: provedor é o DuckDuckGo (sem chave)", (t.match(/Provedor:[^\n]*/) || [""])[0]);
    const entradas = [...t.matchAll(/^\d+\. .+$/gm)];
    check(entradas.length >= 1, "busca: pelo menos um resultado", `resultados=${entradas.length}`);
    const urls = [...t.matchAll(/^\s+(https?:\/\/\S+)$/gm)].map((m) => m[1]);
    check(urls.length >= 1, "busca: URL real presente", urls[0] || "");
    check(urls.every((u) => !/duckduckgo\.com\/l\//.test(u)), "busca: URL desembrulhada (sem redirector)");
    primeiraUrl = urls[0] || "";
  }

  // ---------- 2. O ciclo buscar -> ler fecha ----------
  if (primeiraUrl) {
    const r = await mcp.call("read_page", { url: primeiraUrl, maxChars: 1500, timeoutMs: 20000 });
    const t = r.text;
    check(!r.isError, "ciclo buscar->ler: read_page na URL achada funciona", r.isError ? t.slice(0, 160) : "");
    check(/^# .+/.test(t), "ciclo buscar->ler: página rendeu título");
  }

  // ---------- 3. Consulta vazia é recusada ----------
  {
    const r = await mcp.call("read_search", { q: "" });
    check(r.isError, "validação: consulta vazia vira erro, não lista vazia");
    check(/informe o termo/.test(r.text), "validação: mensagem de motivo clara");
  }
} finally {
  mcp.close();
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
