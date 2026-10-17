// Teste de carga com k6 — web-reader-mcp
//
// O k6 NAO faz parte das dependencias do projeto (o servidor continua com zero
// dependencias). E uma ferramenta externa, usada so para validar capacidade.
//
// Instalar (uma vez, fora do projeto):
//   winget install k6        (Windows)
//   brew install k6          (macOS)
//   sudo apt install k6      (Linux)
//
// Rodar contra um deploy:
//   k6 run -e MCP_URL=https://SEU-APP.onrender.com/mcp -e MCP_TOKEN=xxx dev/load/k6.js
//
// Rodar local (suba antes: MCP_AUTH_TOKEN=t RATE_LIMIT_MAX=1000000 node server.js --http):
//   k6 run -e MCP_URL=http://127.0.0.1:3000/mcp -e MCP_TOKEN=t dev/load/k6.js
//
// Escala do teste (padrao: rampa ate 10.000 VUs):
//   k6 run -e VUS_MAX=10000 -e DURACAO=2m dev/load/k6.js
//
// ATENCAO sobre o rate limit: o servidor limita 60 requisicoes/min por cliente
// (RATE_LIMIT_MAX). Um teste de carga realista precisa de varios IPs de saida,
// senao ele mede o rate limit, e nao a capacidade. Para medir a capacidade,
// suba o servidor com RATE_LIMIT_MAX alto (como no exemplo local acima) OU use
// TRUST_PROXY_HOPS=1 e mande um x-forwarded-for diferente por VU (e o que este
// script faz por padrao, com XFF_POR_VU=true).

import http from "k6/http";
import { check } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import exec from "k6/execution";

const MCP_URL = __ENV.MCP_URL || "http://127.0.0.1:3000/mcp";
const MCP_TOKEN = __ENV.MCP_TOKEN || "";
const VUS_MAX = Number(__ENV.VUS_MAX || 10000);
const DURACAO = __ENV.DURACAO || "1m";
// URL alvo da leitura. Padrao: a mesma para todos (mede cache quente).
const ALVO = __ENV.ALVO || "https://example.com";
// true = cada VU manda um x-forwarded-for proprio (mede capacidade, nao o rate
// limit). false = todos do mesmo IP (mede o rate limit de verdade).
const XFF_POR_VU = (__ENV.XFF_POR_VU || "true") === "true";

// Metrica que importa de verdade: o servidor devolve HTTP 200 mesmo quando a
// ferramenta falha (o erro vem dentro do JSON-RPC, em result.isError). Olhar so
// o status HTTP daria "0 erros" com o servidor recusando quase tudo.
const sucessoReal = new Rate("sucesso_real");
const erroFerramenta = new Counter("erro_de_ferramenta");
const recusado503 = new Counter("recusado_503");
const latenciaFerramenta = new Trend("latencia_ferramenta", true);

export const options = {
  discardResponseBodies: false,
  scenarios: {
    rampa: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "20s", target: Math.max(1, Math.round(VUS_MAX * 0.1)) },
        { duration: "20s", target: Math.max(1, Math.round(VUS_MAX * 0.5)) },
        { duration: "30s", target: VUS_MAX },
        { duration: DURACAO, target: VUS_MAX },
        { duration: "10s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    // O que "estavel sob alta concorrencia" significa na pratica: as
    // requisicoes ATENDIDAS ficam rapidas e quase todas sao bem-sucedidas.
    // Recusar com 503 e aceitavel (e contrapressao); travar nao e.
    sucesso_real: ["rate>0.90"],
    latencia_ferramenta: ["p(95)<2000", "p(99)<10000"],
    http_req_failed: ["rate<0.20"],
  },
};

export default function () {
  const vu = exec.vu.idInTest;
  const corpo = JSON.stringify({
    jsonrpc: "2.0",
    id: vu,
    method: "tools/call",
    params: { name: "read_page", arguments: { url: ALVO, maxChars: 2000 } },
  });

  const headers = { "content-type": "application/json" };
  if (MCP_TOKEN) headers.authorization = `Bearer ${MCP_TOKEN}`;
  if (XFF_POR_VU) {
    // IP distinto por VU: 10.va.vb.vc
    const a = (vu >> 16) & 255;
    const b = (vu >> 8) & 255;
    const c = vu & 255;
    headers["x-forwarded-for"] = `10.${a}.${b}.${c}`;
  }

  const res = http.post(MCP_URL, corpo, { headers, tags: { nome: "read_page" } });
  latenciaFerramenta.add(res.timings.duration);

  if (res.status === 503) {
    recusado503.add(1);
    sucessoReal.add(false);
    return;
  }

  let ok = false;
  if (res.status === 200) {
    try {
      const json = res.json();
      const resultado = json && json.result;
      ok = Boolean(resultado) && !resultado.isError;
      if (!ok) erroFerramenta.add(1);
    } catch {
      // resposta nao-JSON: conta como falha
    }
  }
  sucessoReal.add(ok);

  check(res, {
    "HTTP 200 ou 503 (nunca timeout do cliente)": (r) => r.status === 200 || r.status === 503,
    "ferramenta respondeu sem erro": () => ok,
  });
}

export function handleSummary(dados) {
  const total = dados.metrics.http_reqs ? dados.metrics.http_reqs.values.count : 0;
  const sucesso = dados.metrics.sucesso_real ? dados.metrics.sucesso_real.values.rate : 0;
  const recusas = dados.metrics.recusado_503 ? dados.metrics.recusado_503.values.count : 0;
  const p95 = dados.metrics.latencia_ferramenta ? dados.metrics.latencia_ferramenta.values["p(95)"] : 0;
  const resumo =
    `\n==================== RESUMO ====================\n` +
    `requisicoes:        ${total}\n` +
    `sucesso real:       ${(sucesso * 100).toFixed(1)}%\n` +
    `recusadas (503):    ${recusas}\n` +
    `latencia p95:       ${Number(p95).toFixed(0)} ms\n` +
    `===============================================\n`;
  return { stdout: resumo };
}
