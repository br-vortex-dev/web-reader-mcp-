// _probe-agent.mjs — prova se o fetch global do Node usa a opcao `agent`.
//
// O projeto passa `agent` (Agent http/https com lookup fixado no IP validado)
// para o fetch global, esperando que a conexao use esse IP. Se o fetch global
// (undici) ignorar a opcao, a protecao anti-DNS-rebinding e decorativa e o DNS
// e resolvido de novo na hora da conexao.
//
// Metodo: servidor local em 127.0.0.1 numa porta efemera; pedido para um
// hostname que NUNCA resolve (sufixo .invalid, RFC 2606) COM o agent cujo
// lookup devolve 127.0.0.1. Se o agent for usado, a requisicao chega ao
// servidor local; se for ignorado, falha com ENOTFOUND.

import http from "node:http";

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("CHEGOU NO SERVIDOR LOCAL");
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const host = "host-que-nao-resolve.invalid";
const url = `http://${host}:${port}/`;

const agent = new http.Agent({
  keepAlive: true,
  lookup(hostname, options, callback) {
    callback(null, "127.0.0.1", 4);
  },
});

// [1] fetch global COM o agent: chega no servidor local ou falha com DNS?
try {
  const res = await fetch(url, { agent });
  const texto = await res.text();
  console.log(`[1] fetch global COM agent -> status ${res.status} | corpo: ${texto}`);
  console.log("    => o fetch global USOU o agent (boa noticia)");
} catch (err) {
  const causa = (err && err.cause && err.cause.code) || "";
  console.log(`[1] fetch global COM agent -> ERRO: ${err.message} | causa: ${causa}`);
  console.log(`    => o fetch global IGNOROU o agent (DNS resolvido de novo; ${causa || "sem codigo"})`);
}

// [2] node:http COM o mesmo agent: controle — deve chegar no servidor local.
try {
  const res2 = await new Promise((resolve, reject) => {
    const req = http.get({ hostname: host, port, path: "/", agent }, resolve);
    req.on("error", reject);
  });
  let corpo = "";
  res2.setEncoding("utf8");
  for await (const chunk of res2) corpo += chunk;
  console.log(`[2] node:http COM agent -> status ${res2.statusCode} | corpo: ${corpo}`);
  console.log("    => o mecanismo de agent+lookup funciona (e o caminho para fixar o IP)");
} catch (err) {
  console.log(`[2] node:http COM agent -> ERRO: ${err.message}`);
}

// [3] fetch global SEM agent: controle negativo — deve falhar com DNS.
try {
  const res3 = await fetch(url);
  console.log(`[3] fetch global SEM agent -> status ${res3.status} (inesperado)`);
} catch (err) {
  const causa = (err && err.cause && err.cause.code) || "";
  console.log(`[3] fetch global SEM agent -> falhou como esperado (${causa || err.message})`);
}

agent.destroy();
server.close();
process.exit(0);
