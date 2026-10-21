#!/usr/bin/env node
/**
 * _probe-negativo.mjs — prova que o cache negativo e o prazo funcionam.
 *
 * Duas coisas que precisam de prova medida, não de leitura de código:
 *
 * 1. CACHE NEGATIVO: a segunda chamada numa URL que responde 404 tem de
 *    voltar NA HORA e NÃO tocar o servidor. A prova é a contagem de
 *    requisições no fixture: antes eram 2, agora tem de ser 1.
 *
 * 2. Status transitório NÃO pode ser guardado: um 500 seguido de um 200 tem
 *    de devolver o 200. Se o 500 entrasse no cache negativo, o segundo
 *    pedido receberia erro para sempre (dentro do TTL).
 *
 * Sobe um servidor de fixture local (o mesmo estilo dos testes) e chama as
 * funções de fetch de verdade. Zero dependências.
 */
import http from "node:http";
import { fetchTextCached } from "../src/fetch.mjs";
import { HttpError } from "../src/errors.mjs";

const contagem = { naoExiste: 0, quebraDepoisVolta: 0 };

// Fixo em 200 a segunda vez: é o que separa "cache negativo" de "erro preso".
let voltasDo500 = 0;

const servidor = http.createServer((req, res) => {
  if (req.url === "/nao-existe") {
    contagem.naoExiste++;
    res.writeHead(404, { "content-type": "text/html" });
    res.end("<html><body>nao existe</body></html>");
    return;
  }
  if (req.url === "/transitorio") {
    contagem.quebraDepoisVolta++;
    voltasDo500++;
    if (voltasDo500 <= 2) {
      // Duas falhas: o retry do fetch tenta 2 vezes, então a primeira
      // chamada inteira termina em erro. A SEGUINTE tem de passar.
      res.writeHead(500, { "content-type": "text/html" });
      res.end("<html><body>quebrou</body></html>");
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><body><h1>voltou</h1><p>conteudo ok</p></body></html>");
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><body><h1>ok</h1></body></html>");
});

await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));
const porta = servidor.address().port;
const base = `http://127.0.0.1:${porta}`;

// ALLOW_PRIVATE_HOSTS já foi lido no import; para host local funcionar nos
// testes, o projeto usa o mesmo env. Sem ele, o SSRF recusa 127.0.0.1.
if (!process.env.ALLOW_PRIVATE_HOSTS) {
  console.log("AVISO: rode com ALLOW_PRIVATE_HOSTS=1 para o fixture local passar pelo SSRF");
}

const linha = (rotulo, valor) => console.log(`${rotulo}: ${valor}`);

// ---------- 1. cache negativo ----------
contagem.naoExiste = 0;
let erro1;
try {
  await fetchTextCached(`${base}/nao-existe`);
} catch (e) {
  erro1 = e;
}
const apos1 = contagem.naoExiste;

const t0 = process.hrtime.bigint();
let erro2;
try {
  await fetchTextCached(`${base}/nao-existe`);
} catch (e) {
  erro2 = e;
}
const ms2 = Number(process.hrtime.bigint() - t0) / 1e6;

linha("1a chamada: erro", erro1 && erro1.name);
linha("1a chamada: requisicoes ao servidor", apos1);
linha("2a chamada: erro", erro2 && erro2.name);
linha("2a chamada: requisicoes ao servidor", contagem.naoExiste);
linha("2a chamada: ms", ms2.toFixed(2));
linha("mesmo status preservado", erro2 instanceof HttpError ? erro2.status : "NAO");
linha("REQUISICOES NAO AUMENTARAM", contagem.naoExiste === apos1 ? "SIM" : "NAO");

// ---------- 2. transitório não pode ficar preso ----------
voltasDo500 = 0;
let primErr;
try {
  await fetchTextCached(`${base}/transitorio`);
} catch (e) {
  primErr = e;
}
let segunda;
try {
  segunda = await fetchTextCached(`${base}/transitorio`);
} catch (e) {
  segunda = `ERRO: ${e.name} ${e.status ?? ""}`;
}
linha("500 na 1a chamada", primErr ? primErr.name : "nao falhou");
linha(
  "2a chamada devolveu 200",
  typeof segunda === "object" && segunda && segunda.text && segunda.text.includes("conteudo ok") ? "SIM" : `NAO (${segunda})`
);

servidor.close();
process.exit(0);
