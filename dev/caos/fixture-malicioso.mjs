// Servidor "site malicioso": cada rota existe para tentar quebrar o leitor.
// Nada aqui e site de verdade — e veneno servido de proposito.
import http from "node:http";
import zlib from "node:zlib";

export function criarMalicioso() {
  const estado = { requisicoes: 0, porRota: new Map() };
  const conta = (rota) => {
    estado.requisicoes++;
    estado.porRota.set(rota, (estado.porRota.get(rota) || 0) + 1);
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://local");
    const rota = url.pathname;
    conta(rota);

    switch (rota) {
      // 1) Bomba de gzip: 200 MB de zeros comprimem para poucos KB.
      case "/bomba-gzip": {
        const corpo = Buffer.alloc(200 * 1024 * 1024, 0);
        const comprimido = zlib.gzipSync(corpo, { level: 9 });
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-encoding": "gzip",
          "content-length": comprimido.length,
        });
        res.end(comprimido);
        return;
      }

      // 2) Bomba de brotli (mesma ideia, outro formato).
      case "/bomba-brotli": {
        const corpo = Buffer.alloc(150 * 1024 * 1024, 0);
        const comprimido = zlib.brotliCompressSync(corpo);
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-encoding": "br",
          "content-length": comprimido.length,
        });
        res.end(comprimido);
        return;
      }

      // 3) Content-Length mente: declara 10 bytes, envia 20 MB.
      case "/content-length-mente": {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": "10" });
        res.write("<html><body><h1>mentiu</h1>");
        const lixo = "<p>" + "a".repeat(1024) + "</p>";
        for (let i = 0; i < 20000; i++) {
          if (!res.write(lixo)) {
            // respeita o backpressure de leve, mas o ponto e estourar
          }
        }
        res.end("</body></html>");
        return;
      }

      // 4) HTML gigante (25 MB de texto util).
      case "/html-gigante": {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.write("<!DOCTYPE html><html><head><title>Gigante</title></head><body><h1>Gigante</h1>");
        const bloco = "<p>" + "palavra ".repeat(200) + "</p>\n";
        for (let i = 0; i < 22000; i++) res.write(bloco);
        res.end("</body></html>");
        return;
      }

      // 5) Aninhamento profundo: 200 mil <div> abertos sem fechar.
      case "/aninhamento": {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.write("<!DOCTYPE html><html><body>");
        for (let i = 0; i < 200000; i++) res.write("<div>");
        res.write("texto no fundo do poco");
        res.end("</body></html>");
        return;
      }

      // 6) Cerca de codigo aberta e nunca fechada, em volume.
      case "/cerca-aberta": {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.write("<!DOCTYPE html><html><body>");
        for (let i = 0; i < 5000; i++) res.write("<pre>` ``` `````` ");
        res.end("</body></html>");
        return;
      }

      // 7) Tabela monstro: 2 mil colunas x 200 linhas.
      case "/tabela-monstro": {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.write("<!DOCTYPE html><html><body><table><thead><tr>");
        for (let c = 0; c < 2000; c++) res.write(`<th>h${c}</th>`);
        res.write("</tr></thead><tbody>");
        for (let l = 0; l < 200; l++) {
          res.write("<tr>");
          for (let c = 0; c < 2000; c++) res.write(`<td>c${l}_${c}</td>`);
          res.write("</tr>");
        }
        res.end("</tbody></table></body></html>");
        return;
      }

      // 8) Entidades XML "billion laughs" (para o read_feed/read_json).
      case "/billion-laughs": {
        const niveis = 10;
        let dtd = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">';
        for (let i = 1; i <= niveis; i++) {
          dtd += `<!ENTITY lol${i} "${`&lol${i - 1};`.repeat(10)}">`;
        }
        dtd += "]>";
        res.writeHead(200, { "content-type": "application/rss+xml" });
        res.end(`${dtd}<rss><channel><title>&lol${niveis};</title></channel></rss>`);
        return;
      }

      // 9) JSON absurdamente aninhado (profundidade 100 mil).
      case "/json-profundo": {
        res.writeHead(200, { "content-type": "application/json" });
        res.write("[".repeat(100000));
        res.end("]".repeat(100000));
        return;
      }

      // 10) JSON gigante com chave repetida e numero absurdo.
      case "/json-doente": {
        const itens = [];
        for (let i = 0; i < 300000; i++) itens.push(`{"i":${i},"n":${"9".repeat(400)}}`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(`{"itens":[${itens.join(",")}]}`);
        return;
      }

      // 11) Bytes invalidos de UTF-8 no meio do HTML.
      case "/utf8-quebrado": {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        const buf = Buffer.concat([
          Buffer.from("<html><body><h1>quebrado</h1><p>"),
          Buffer.from([0xff, 0xfe, 0xc0, 0x80, 0xed, 0xa0, 0x80]),
          Buffer.from("</p></body></html>"),
        ]);
        res.end(buf);
        return;
      }

      // 12) Lento: aceita e responde em 60 s (bem acima do timeout).
      case "/lento": {
        setTimeout(() => {
          res.writeHead(200, { "content-type": "text/html" });
          res.end("<html><body><h1>tarde demais</h1></body></html>");
        }, 60000);
        return;
      }

      // 13) Nunca termina: manda cabecalho e um pedaco, depois silencio.
      case "/nunca-termina": {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.write("<html><body><h1>nao acaba</h1>");
        // nao chama end(): a conexao fica pendurada para sempre
        return;
      }

      // 14) Pinga um byte por segundo para sempre (slow-loris de saida).
      case "/pinga": {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        let i = 0;
        const t = setInterval(() => {
          res.write("x");
          if (++i > 300) {
            clearInterval(t);
            res.end();
          }
        }, 1000);
        res.on("close", () => clearInterval(t));
        return;
      }

      // 15) Redirect infinito para si mesmo.
      case "/redirect-infinito":
        res.writeHead(302, { location: "/redirect-infinito" });
        res.end();
        return;

      // 16) Redirect para host interno (SSRF por salto).
      case "/redirect-interno":
        res.writeHead(302, { location: `http://127.0.0.1:${server.address().port}/segredo` });
        res.end();
        return;

      // 17) Redirect para protocolo exotico.
      case "/redirect-file":
        res.writeHead(302, { location: "file:///C:/Windows/win.ini" });
        res.end();
        return;

      // 18) Alvo do "segredo" interno (nao deveria ser alcancado por salto).
      case "/segredo":
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html><body><h1>SEGREDO-INTERNO-ALCANCADO</h1></body></html>");
        return;

      // 19) Status esquisitos e sem content-type.
      case "/sem-content-type":
        res.writeHead(200);
        res.end("<!DOCTYPE html><html><body><h1>sem tipo</h1></body></html>");
        return;

      // 20) Diz HTML mas entrega binario.
      case "/binario-como-html": {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]));
        return;
      }

      // 21) HTML querendo virar JSON e PDF.
      case "/html-como-pdf": {
        res.writeHead(200, { "content-type": "application/pdf" });
        res.end("<!DOCTYPE html><html><body>isto nao e pdf</body></html>");
        return;
      }

      // 22) 429 eterno com Retry-After absurdo.
      case "/retry-infinito":
        res.writeHead(429, { "content-type": "text/html", "retry-after": "86400" });
        res.end("<html><body>nunca</body></html>");
        return;

      // 23) HTML com muitos links (10 mil) para explodir o extract/crawl.
      case "/muitos-links": {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.write("<!DOCTYPE html><html><body><h1>links</h1>");
        for (let i = 0; i < 10000; i++) res.write(`<a href="/p/${i}">link ${i}</a>`);
        res.end("</body></html>");
        return;
      }

      // 24) Sitemap malformado gigante.
      case "/sitemap.xml": {
        res.writeHead(200, { "content-type": "application/xml" });
        let xml = '<?xml version="1.0"?><urlset>';
        for (let i = 0; i < 50000; i++) xml += `<url><loc>http://x/${i}</loc></url>`;
        res.end(xml + "</urlset>");
        return;
      }

      // 25) Robots.txt gigante (1 MB de regras).
      case "/robots.txt": {
        res.writeHead(200, { "content-type": "text/plain" });
        let txt = "User-agent: *\n";
        for (let i = 0; i < 20000; i++) txt += `Disallow: /lixo${i}\n`;
        res.end(txt);
        return;
      }

      // 26) Cabeçalhos absurdos (10 mil headers).
      case "/headers-monstro": {
        const h = { "content-type": "text/html; charset=utf-8" };
        for (let i = 0; i < 5000; i++) h[`x-lixo-${i}`] = "v".repeat(50);
        res.writeHead(200, h);
        res.end("<html><body><h1>headers</h1></body></html>");
        return;
      }

      // 27) Caractere NUL e controles no corpo.
      case "/nul": {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(Buffer.concat([Buffer.from("<html><body>"), Buffer.alloc(5000, 0), Buffer.from("</body></html>")]));
        return;
      }

      // 28) Pagina normal (controle: tem de funcionar sempre).
      case "/ok": {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end("<!DOCTYPE html><html><head><title>OK</title></head><body><h1>Controle</h1><p>pagina saudavel</p></body></html>");
        return;
      }

      default: {
        // /p/0..N do muitos-links: pagina simples.
        if (rota.startsWith("/p/")) {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(`<!DOCTYPE html><html><body><h1>${rota}</h1></body></html>`);
          return;
        }
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("nao existe");
      }
    }
  });

  // Conexoes que nunca enviam nada: o servidor malicioso nao deve derrubar
  // o socket (quem tem de desistir e o cliente).
  server.keepAliveTimeout = 0;
  server.requestTimeout = 0;

  return { server, estado };
}
