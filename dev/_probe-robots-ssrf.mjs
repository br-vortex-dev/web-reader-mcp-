// _probe-robots-ssrf.mjs — prova se o fetch do robots.txt escapa do bloqueio SSRF.
//
// ANTES da correção: o robots.txt era buscado em paralelo com a validação de
// host (Promise.all). Com ALLOW_PRIVATE_HOSTS desligado, o servidor interno
// AINDA recebia GET /robots.txt — vazamento provado por este mesmo probe.
//
// DEPOIS: a checagem de SSRF roda primeiro e o robots sai pelo transporte
// pinado. O servidor interno não pode ser tocado por caminho nenhum.

import http from "node:http";

const recebidas = [];
const server = http.createServer((req, res) => {
  recebidas.push(req.url);
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end("<html><body><h1>pagina interna</h1></body></html>");
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/pagina`;

delete process.env.ALLOW_PRIVATE_HOSTS; // padrao de producao: bloqueante

const mod = await import("../src/fetch.mjs");

try {
  const payload = await mod.fetchTextCached(url, { timeoutMs: 3000 });
  console.log(`[1] NAO bloqueou! conteudo lido: ${String(payload.text).slice(0, 60)}`);
} catch (err) {
  console.log(`[1] bloqueado como esperado: ${err.name} — ${String(err.message).slice(0, 90)}`);
}

// Deixa qualquer coisa que ainda esteja em voo aterrissar antes de olhar.
await new Promise((resolve) => setTimeout(resolve, 800));

console.log(`[2] requisicoes que chegaram ao servidor interno: ${JSON.stringify(recebidas)}`);
if (recebidas.some((u) => String(u).includes("robots.txt"))) {
  console.log("[3] VAZAMENTO: o fetch do robots.txt passou por cima do bloqueio SSRF");
} else if (recebidas.length > 0) {
  console.log("[3] o servidor interno foi tocado, mas nao pelo robots.txt");
} else {
  console.log("[3] nenhum vazamento: o servidor interno nao foi tocado");
}

server.close();
process.exit(0);
