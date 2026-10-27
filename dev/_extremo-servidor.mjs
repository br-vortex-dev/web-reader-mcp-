#!/usr/bin/env node
/**
 * _extremo-servidor.mjs — servidor local que obedece ao pedido e conta bytes.
 *
 * Existe para MEDIR O TETO, nao para testar funcionalidade:
 *   /forte?mb=N&id=X  -> pagina de texto puro com N MB, sem Content-Length
 *   /pagina?i=X       -> pagina de 1,4 MB (pico de concorrencia)
 *   /mini?i=X&ms=M    -> pagina de ~2 KB, opcionalmente lenta
 *   /nunca            -> aceita a conexao e nunca responde (timeout)
 *   /lenta            -> responde 1 KB e depois pinga devagar (timeout no meio)
 *   /__stats          -> bytes que o servidor TENTOU escrever em cada pedido
 *
 * `abortado=true` em /__stats e a prova de que o cliente parou de ler: o
 * servidor tinha mais para mandar e a conexao fechou.
 */
import http from "node:http";

const MB = 1024 * 1024;
const bloco = Buffer.from("<p>" + "x".repeat(65528) + "</p>", "latin1"); // 65536 B de texto puro
const stats = new Map();

function registrar(id, caminho) {
  const st = { id, caminho, bytes: 0, completo: false, abortado: false };
  stats.set(id, st);
  return st;
}

// `pausaMs` espaça os blocos de propósito: sem isso o servidor despeja vários
// MB no buffer do socket antes de o cliente conseguir abortar, e o contador de
// bytes "tentados" fica até 6 MB acima do teto do cliente, escondendo o corte.
function enviarFluxo(res, st, total, prefixo, pausaMs = 0) {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  let restante = Math.max(0, total - prefixo.length);

  const escrever = (buf) =>
    new Promise((resolve) => {
      if (res.destroyed || res.writableEnded) return resolve(false);
      st.bytes += buf.length;
      if (res.write(buf)) return resolve(true);
      const limpar = () => {
        res.off("drain", aoDrenar);
        res.off("close", aoFechar);
      };
      const aoDrenar = () => {
        limpar();
        resolve(!res.destroyed);
      };
      const aoFechar = () => {
        limpar();
        resolve(false);
      };
      res.once("drain", aoDrenar);
      res.once("close", aoFechar);
    });

  (async () => {
    if (!(await escrever(prefixo))) return;
    while (restante > 0) {
      const n = Math.min(bloco.length, restante);
      if (!(await escrever(n === bloco.length ? bloco : bloco.subarray(0, n)))) return;
      restante -= n;
      if (pausaMs > 0 && restante > 0) await new Promise((r) => setTimeout(r, pausaMs));
    }
    if (!res.destroyed) {
      st.completo = true;
      res.end("</body></html>");
    }
  })();

  res.on("close", () => {
    if (!st.completo) st.abortado = true;
  });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://local");
  const id = u.searchParams.get("id") || u.searchParams.get("i") || u.pathname;

  if (u.pathname === "/__stats") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify([...stats.values()]));
    return;
  }
  if (u.pathname === "/robots.txt") {
    res.writeHead(404);
    res.end();
    return;
  }
  if (u.pathname === "/nunca") {
    registrar(id, "nunca");
    return; // conexao fica aberta para sempre
  }
  if (u.pathname === "/lenta") {
    const st = registrar(id, "lenta");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    const pedaco = Buffer.from("<p>" + "z".repeat(1000) + "</p>");
    st.bytes += pedaco.length;
    res.write(pedaco);
    const timer = setInterval(() => {
      if (res.destroyed) return clearInterval(timer);
      const p = Buffer.from("<p>" + "z".repeat(100) + "</p>");
      st.bytes += p.length;
      res.write(p);
    }, 100);
    res.on("close", () => {
      clearInterval(timer);
      st.abortado = true;
    });
    return;
  }
  if (u.pathname === "/mini") {
    const atraso = Number(u.searchParams.get("ms")) || 0;
    const st = registrar(id, "mini");
    const responder = () => {
      if (res.destroyed) return;
      st.completo = true;
      const corpo =
        `<!DOCTYPE html><html><head><title>Mini ${id}</title></head><body>` +
        `<h1>Mini</h1><p>${"y".repeat(1800)}</p></body></html>`;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(corpo);
    };
    if (atraso > 0) setTimeout(responder, atraso);
    else responder();
    return;
  }
  if (u.pathname === "/pagina") {
    const total = 1400 * 1024;
    const prefixo = Buffer.from(
      `<!DOCTYPE html><html><head><title>Pagina ${id}</title></head><body><h1>Pagina ${id}</h1>`,
      "latin1"
    );
    enviarFluxo(res, registrar(id, "pagina"), total, prefixo);
    return;
  }
  if (u.pathname === "/forte") {
    const mb = Number(u.searchParams.get("mb")) || 20;
    const pausaMs = u.searchParams.has("pace") ? Number(u.searchParams.get("pace")) : 2;
    const prefixo = Buffer.from(
      `<!DOCTYPE html><html><head><title>Forte ${id}</title></head><body><h1>Forte</h1>`,
      "latin1"
    );
    enviarFluxo(res, registrar(id, "forte"), mb * MB, prefixo, pausaMs);
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(0, "127.0.0.1", () => {
  console.log(`URL http://127.0.0.1:${server.address().port}`);
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
