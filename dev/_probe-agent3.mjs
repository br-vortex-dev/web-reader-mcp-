// _probe-agent3.mjs — prova de que o servidor REAL agora fixa o IP validado.
//
// O probe original (_probe-agent.mjs) mostrou que o fetch global ignorava o
// `agent`. Agora o transporte é o de net.mjs (node:http/https + agentValidado).
// Este probe sobe o servidor MCP de verdade e confere que o erro de rede sai
// com a causa real (o BUG-4 continua preservado no transporte novo).

import { startMcp } from "../tests/helpers.mjs";
import { sleep } from "../tests/helpers.mjs";

const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1" });
try {
  const r = await mcp.call("read_page", { url: "http://127.0.0.1:1/pagina", maxChars: 300, timeoutMs: 2000 });
  console.log(`[1] leitura de porta fechada -> isError=${r.isError}`);
  console.log(`    mensagem: ${r.text.slice(0, 120)}`);
  // O erro tem de citar a causa real (ECONNREFUSED), não "fetch failed" pelado.
  console.log(`[2] cita ECONNREFUSED: ${/ECONNREFUSED|connect/i.test(r.text)}`);
  console.log("[3] (a prova end-to-end do transporte são os testes de redirects, crawl e DNS rebinding da suíte)");
} finally {
  mcp.close();
  await sleep(300); // deixa o filho encerrar antes de o processo pai sair
}
