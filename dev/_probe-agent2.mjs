// _probe-agent2.mjs — o mecanismo node:http + agentValidado (o do projeto) funciona?
//
// O _probe-agent.mjs provou que o fetch global IGNORA a opcao `agent` (ENOTFOUND
// num hostname que nunca resolve). Aqui testamos o caminho que o projeto passou
// a usar: `node:http` direto com o `agentValidado` (agora em net.mjs) para ver
// se a conexao e entregue ao IP fixado mesmo quando o DNS do hostname nao resolve.

import http from "node:http";
import { agentValidado } from "../src/net.mjs";

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(`CHEGOU host=${req.headers.host} path=${req.url}`);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const host = "host-que-nao-resolve.invalid";
const agent = agentValidado(`http://${host}:${port}/`, "127.0.0.1");
console.log(`[0] agentValidado criado para ${host} -> IP fixo 127.0.0.1`);

// [1] requisicao basica: chega no servidor local?
try {
  const res = await new Promise((resolve, reject) => {
    const req = http.get({ hostname: host, port, path: "/primeira", agent }, resolve);
    req.on("error", reject);
  });
  let corpo = "";
  res.setEncoding("utf8");
  for await (const chunk of res) corpo += chunk;
  console.log(`[1] node:http + agentValidado -> ${res.statusCode} | ${corpo}`);
} catch (err) {
  console.log(`[1] FALHOU: ${err.message}`);
}

// [2] segunda requisicao (keep-alive, sem DNS novo): continua chegando?
try {
  const res = await new Promise((resolve, reject) => {
    const req = http.get({ hostname: host, port, path: "/segunda", agent }, resolve);
    req.on("error", reject);
  });
  for await (const _ of res) {
    // drena
  }
  console.log(`[2] segunda com keep-alive -> ${res.statusCode}`);
} catch (err) {
  console.log(`[2] FALHOU: ${err.message}`);
}

// [3] abort via signal: que erro sai? (informa a adaptacao do classificarErro)
try {
  const controller = new AbortController();
  const promessa = new Promise((resolve, reject) => {
    const req = http.get({ hostname: host, port, path: "/terceira", agent, signal: controller.signal }, resolve);
    req.on("error", reject);
  });
  controller.abort(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
  await promessa;
  console.log("[3] abort: resolveu (inesperado)");
} catch (err) {
  console.log(
    `[3] abort -> name=${err.name} code=${err.code || "-"} | message=${err.message} | cause=${err.cause ? err.cause.message + "/" + (err.cause.code || "-") : "nenhuma"}`
  );
}

// [4] abort no meio do corpo (servidor manda headers e trava): qual erro no stream?
const serverLento = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.write("pedaco-1\n");
  // e nunca termina
});
await new Promise((resolve) => serverLento.listen(0, "127.0.0.1", resolve));
const portLento = serverLento.address().port;
const agentLento = agentValidado(`http://${host}:${portLento}/`, "127.0.0.1");
try {
  const controller2 = new AbortController();
  const res = await new Promise((resolve, reject) => {
    const req = http.get({ hostname: host, port: portLento, path: "/lento", agent: agentLento, signal: controller2.signal }, resolve);
    req.on("error", reject);
  });
  setTimeout(() => controller2.abort(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })), 100);
  try {
    for await (const chunk of res) {
      // le o primeiro pedaco e depois o abort chega
    }
    console.log("[4] stream terminou (inesperado)");
  } catch (err) {
    console.log(`[4] abort no corpo -> name=${err.name} code=${err.code || "-"} | message=${err.message}`);
  }
} catch (err) {
  console.log(`[4] abort no corpo (antes do stream) -> ${err.message}`);
}

agent.destroy();
agentLento.destroy();
server.close();
serverLento.close();
process.exit(0);
