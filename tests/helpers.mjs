// Infraestrutura dos testes: sobe um servidor de fixture (paginas locais) e o
// servidor MCP de verdade, em modo HTTP, numa porta livre.
//
// Nada aqui e um caso de teste — por isso este arquivo mora em `tests/` (e nao
// em `test/`), para o `node --test` nao tentar executa-lo como teste.
import { spawn } from "node:child_process";
import http from "node:http";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// TEST_SERVER_PATH permite apontar a suite para outra copia do servidor
// (usado para conferir que os testes realmente falham contra a versao antiga).
export const SERVER_PATH = process.env.TEST_SERVER_PATH || join(__dirname, "..", "server.js");
export const TOKEN = "token-de-teste";

// Porta livre: abre em 0, le a porta atribuida e fecha.
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const PAD =
  "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore. ".repeat(6);

// Fixture do parser: um caso por problema que ja corrompeu o conteudo.
export const FIXTURE_HTML = `<!DOCTYPE html><html><head><title>Fixture Parser</title></head><body>
<h1>Titulo</h1>
<p>CASO 1 (menor-que no texto): Compare 3 < 5 e 5 > 3 neste paragrafo.</p>
<p>CASO 3 (entidades): &ccedil;&atilde;o &eacute; &Aacute;gua &Oslash; &amp; fim. Numericas: &#231; &#xE7;. Desconhecida: &naoexiste; Fora de range: &#99999999;</p>
<p>CASO 4 (codigo Python):</p>
<pre><code>def soma(a, b):
    if a > 0:
        return a + b
    return 0
</code></pre>
<p>CASO 5 (codigo YAML):</p>
<pre><code>servico:
  nome: api
  portas:
    - 80
    - 443
</code></pre>
<p>CASO 6 (tabela com cabecalho th):</p>
<table><thead><tr><th>Nome</th><th>Valor</th></tr></thead><tbody><tr><td>A</td><td>1</td></tr><tr><td>B|pipe</td><td>2</td></tr></tbody></table>
<p>CASO 7 (tabela sem cabecalho):</p>
<table><tbody><tr><td>sem</td><td>cabecalho</td></tr><tr><td>x</td><td>y</td></tr></tbody></table>
<p>CASO 8 (tabela com br e colspan):</p>
<table><tr><th colspan="2">Titulo</th></tr><tr><td>linha<br>quebrada</td><td>ok</td></tr></table>
<p>CASO 9 (menor-que no fim do documento):</p>
<
<p>${PAD}</p>
</body></html>`;

// Servidor de fixture. Rotas:
//   /pagina                     -> FIXTURE_HTML
//   /page/<id>?kb=N             -> pagina de ~N KB, com contador de requisicoes
//   /crawl/start                -> links para paginas que leem e que falham
//   /chain/N                    -> N redirects relativos e depois /pagina
//   /redirect-to-private        -> 302 para http://127.0.0.1:<porta>/pagina
//   /redirect-to-file           -> 302 para file:///etc/passwd
//   /robots.txt                 -> regras de robots do modo "regras" (padrao)
//                                   ou HTTP 500 no modo "erro500"
//   /privado/<qualquer>         -> MARCADO-PRIVADO   (Disallow: /privado)
//   /privado/publico            -> MARCADO-PUBLICO   (Allow mais longa vence)
//   /coisa/curinga              -> MARCADO-CURINGA   (Disallow: /*/curinga)
//   /termo                      -> MARCADO-TERMO     (Disallow: /termo$)
//   /termo-extra                -> MARCADO-TERMO-EXTRA (nao casa com /termo$)
//   /livre                      -> MARCADO-LIVRE     (controle permitido)
export async function startFixture({ robots = "regras" } = {}) {
  // Contador de requisicoes por id: deixa visivel de FORA se a resposta veio do
  // cache (mesmo contador) ou foi baixada de novo (contador maior).
  const hits = new Map();
  // Contador por caminho (usado pelos testes de retry: 403 definitivo tem de
  // bater no servidor UMA vez so).
  const contagem = new Map();
  // Candidatos "/api/..." que o servidor realmente buscou (ordem de chegada).
  const probes = [];

  const server = http.createServer((req, res) => {
    const path = String(req.url || "/");

    // /page/<id>?kb=N[&ms=M] -> pagina de ~N KB com o contador de requisicoes no
    // texto. `ms` atrasa a resposta (usado pelos testes de junção em voo para
    // garantir que os pedidos chegam ENQUANTO a busca esta em andamento).
    if (path.startsWith("/page/")) {
      const url = new URL(path, "http://local");
      const id = url.pathname.slice("/page/".length);
      const kb = Number(url.searchParams.get("kb")) || 1;
      const ms = Number(url.searchParams.get("ms")) || 0;
      const n = (hits.get(id) || 0) + 1;
      hits.set(id, n);
      const recheio = "x".repeat(Math.max(0, kb * 1024 - 400));
      const responder = () => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          `<!DOCTYPE html><html><head><title>Pagina ${id}</title></head><body>` +
            `<h1>Pagina ${id}</h1><p>REQ-${id}-${n}</p><p>${recheio}</p></body></html>`
        );
      };
      if (ms > 0) setTimeout(responder, ms);
      else responder();
      return;
    }

    // /retry-after?segundos=N -> devolve 429 com Retry-After na PRIMEIRA
    // requisicao e a pagina normal depois, para dar para medir a espera.
    if (path.startsWith("/retry-after")) {
      const u = new URL(path, "http://local");
      const segundos = u.searchParams.get("segundos") || "2";
      const chave = `retry:${segundos}`;
      const n = (hits.get(chave) || 0) + 1;
      hits.set(chave, n);
      if (n === 1) {
        res.writeHead(429, { "content-type": "text/html", "retry-after": segundos });
        res.end("<html><body>429</body></html>");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<!DOCTYPE html><html><head><title>Depois do retry</title></head><body><h1>Depois do retry</h1><p>ok</p></body></html>");
      return;
    }

    // /lento?ms=N -> pagina que demora N ms (para testar limites de concorrencia)
    if (path.startsWith("/lento")) {
      const u = new URL(path, "http://local");
      const ms = Number(u.searchParams.get("ms")) || 300;
      setTimeout(() => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end("<!DOCTYPE html><html><head><title>Lento</title></head><body><h1>Lento</h1><p>ok</p></body></html>");
      }, ms);
      return;
    }

    // Paginas do teste de crawl parcial: algumas leem, outras falham de
    // proposito (HTTP 404, timeout e conteudo nao-HTML).
    if (path === "/crawl/start") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>Crawl</title></head><body><h1>Inicio</h1>" +
          '<p><a href="/crawl/ok1">OK 1</a></p>' +
          '<p><a href="/crawl/ok2">OK 2</a></p>' +
          '<p><a href="/crawl/erro404">Erro 404</a></p>' +
          '<p><a href="/crawl/trava">Trava</a></p>' +
          '<p><a href="/crawl/naohtml">Nao HTML</a></p>' +
          "</body></html>"
      );
      return;
    }
    if (path.startsWith("/crawl/ok")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html><html><head><title>${path}</title></head><body><h1>${path}</h1><p>conteudo ok</p></body></html>`);
      return;
    }
    if (path === "/crawl/erro404") {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><body>404</body></html>");
      return;
    }
    if (path === "/crawl/trava") {
      return; // aceita a conexao e nunca responde (forca timeout)
    }
    if (path === "/crawl/naohtml") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"isto":"nao e html"}');
      return;
    }

    // Filtro de navegacao do crawl: os padroes casam por SEGMENTO do
    // pathname. /nav/about (segmento "about" puro) tem de ser descartado;
    // /blog/about-cookies (so contem a substring) NAO pode ser.
    if (path === "/nav/start") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>Nav</title></head><body><h1>Inicio nav</h1>" +
          '<p><a href="/nav/about">about puro</a></p>' +
          '<p><a href="/blog/about-cookies">about cookies</a></p>' +
          '<p><a href="/nav/login">login</a></p>' +
          '<p><a href="/arquivo">arquivo</a></p>' +
          '<p><a href="/arquivo/page/2">paginacao</a></p>' +
          "</body></html>"
      );
      return;
    }
    if (path === "/nav/about") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end('<!DOCTYPE html><html><head><title>About</title></head><body><h1>MARCADO-ABOUT-PURO</h1></body></html>');
      return;
    }
    if (path === "/blog/about-cookies") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end('<!DOCTYPE html><html><head><title>Cookies</title></head><body><h1>MARCADO-ABOUT-COOKIES</h1></body></html>');
      return;
    }
    if (path === "/arquivo") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end('<!DOCTYPE html><html><head><title>Arquivo</title></head><body><h1>MARCADO-ARQUIVO</h1></body></html>');
      return;
    }

    // /dinamica -> pagina curta com dados embutidos (__NEXT_DATA__): dispara o
    // caminho de read_dynamic_page que montava o cabecalho duas vezes.
    if (path === "/dinamica") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>ComDados</title>" +
          '<meta name="description" content="Descricao de teste"></head><body>' +
          '<div id="root"></div>' +
          '<script id="__NEXT_DATA__" type="application/json">' +
          '{"props":{"pageProps":{"titulo":"Produto X","preco":123.45}}}' +
          "</script></body></html>"
      );
      return;
    }

    // /api/pagina?cands=/a|/b -> pagina curta (markdown < 300 chars) cujo script
    // cita os candidatos. Dispara o extractEmbeddedData do read_page.
    if (path.startsWith("/api/pagina")) {
      const u = new URL(path, "http://local");
      const cands = (u.searchParams.get("cands") || "/api/probe/um").split("|").filter(Boolean);
      const scripts = cands.map((c) => `fetch(${JSON.stringify(c)});`).join("");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<!DOCTYPE html><html><head><title>Api</title></head><body>` +
          `<div id="root"></div><script>${scripts}</script></body></html>`
      );
      return;
    }

    // /api/probe/<nome> -> registra a chamada e devolve JSON.
    if (path.startsWith("/api/probe/")) {
      const nome = path.slice("/api/probe/".length);
      probes.push(nome);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ nome, valor: 42 }));
      return;
    }

    // /api/trava -> aceita a conexao e nunca responde (forca timeout).
    if (path.startsWith("/api/trava")) {
      return;
    }

    if (path.startsWith("/chain/")) {
      const n = Number(path.slice("/chain/".length));
      if (Number.isFinite(n) && n > 0) {
        // Location RELATIVO de proposito: testa a resolucao contra a URL atual.
        res.writeHead(302, { location: `/chain/${n - 1}` });
        res.end();
        return;
      }
    }

    // /longa -> pagina bem maior que o DEFAULT_MAX_CHARS (8000), para o teste do
    // truncamento padrao: sem maxChars, o corte tem de acontecer em 8000.
    if (path === "/longa") {
      const blocos = Array.from({ length: 120 }, (_, i) => `<p>Paragrafo ${i} com texto de enchimento para compor uma pagina longa o bastante.</p>`).join("");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html><html><head><title>Pagina Longa</title></head><body><h1>Pagina Longa</h1>${blocos}</body></html>`);
      return;
    }

    // /gigante -> pagina MUITO maior que o teto entregavel (HARD_MAX_CHARS).
    // Tem duas marcas: INICIO-GIGANTE aparece antes do teto e FIM-GIGANTE
    // fica bem depois — e a marca de que a conversao NAO deve ser completada
    // so para joga-la fora (parada antecipada). O teste exige o inicio e
    // aceita a ausencia do fim (que era lixo, nunca ia ao cliente).
    if (path === "/gigante") {
      const blocos = Array.from(
        { length: 900 },
        (_, i) =>
          `<p>Paragrafo ${i} de enchimento para empurrar a pagina muito alem do teto de saida do servidor. ` +
          `Texto repetido de proposito para o markdown passar de 250 mil caracteres sem esforco. ` +
          `${"palavra ".repeat(6)}</p>`
      ).join("");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<!DOCTYPE html><html><head><title>Pagina Gigante</title></head><body>` +
          `<h1>INICIO-GIGANTE</h1>${blocos}<h1>FIM-GIGANTE</h1></body></html>`
      );
      return;
    }

    // /enorme -> corpo MUITO maior que MAX_RESPONSE_BYTES (o teste sobe o
    // servidor com o teto baixo): o download tem de abortar em streaming.
    // Sem content-length (chunked) de proposito: o corte do cliente so pode
    // vir da contagem REAL do streaming, que e o que este teste prova.
    if (path === "/enorme") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      // 1 MB de corpo de verdade, num envio so.
      res.end("<!DOCTYPE html><html><body>" + "x".repeat(1024 * 1024) + "</body></html>");
      return;
    }

    // /longchain/N -> N redirects ABSOLUTOS e depois /pagina. Serve para travar
    // o padrao de redirects (uma cadeia de 5 passa, uma de 6 e recusada).
    if (path.startsWith("/longchain/")) {
      const n = Number(path.slice("/longchain/".length));
      if (Number.isFinite(n) && n > 0) {
        res.writeHead(302, { location: `http://127.0.0.1:${server.address().port}/longchain/${n - 1}` });
        res.end();
        return;
      }
    }

    if (path === "/redirect-to-private") {
      res.writeHead(302, { location: `http://127.0.0.1:${server.address().port}/pagina` });
      res.end();
      return;
    }

    if (path === "/redirect-to-file") {
      res.writeHead(302, { location: "file:///etc/passwd" });
      res.end();
      return;
    }

    // ---- fixtures da rodada de correcoes (bugs da bateria de campo) ----

    // BUG-1: robots.txt de verdade (texto puro). Com as quebras coladas,
    // "Disallow: /" do Yandex passa a valer para todo mundo.
    if (path === "/robots") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(
        "User-agent: *\nDisallow: /busca\nAllow: /busca/about\n\n" +
          "User-agent: Yandex\nDisallow: /\n\nSitemap: https://exemplo.org/sitemap.xml\n"
      );
      return;
    }

    // BUG-1: sitemap XML real (varias URLs em linhas separadas).
    if (path === "/sitemap-fixture") {
      res.writeHead(200, { "content-type": "application/xml; charset=utf-8" });
      res.end(
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
          "  <url><loc>https://exemplo.org/</loc><lastmod>2026-10-14</lastmod></url>\n" +
          "  <url><loc>https://exemplo.org/sobre</loc><lastmod>2026-10-13</lastmod></url>\n" +
          "  <url><loc>https://exemplo.org/contato</loc><lastmod>2026-10-12</lastmod></url>\n" +
          "</urlset>\n"
      );
      return;
    }

    // BUG-1: markdown cru servido como texto puro.
    if (path === "/md-fixture") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("# Titulo\n\nPrimeiro paragrafo.\n\n- item um\n- item dois\n\n## Fim\n");
      return;
    }

    // BUG-2: feed Atom com CDATA. Como XML, tem de voltar inteiro (cru).
    if (path === "/atom") {
      res.writeHead(200, { "content-type": "application/atom+xml; charset=utf-8" });
      res.end(
        '<?xml version="1.0" encoding="utf-8"?>\n' +
          '<feed xmlns="http://www.w3.org/2005/Atom">\n' +
          "  <title>Feed de teste</title>\n" +
          '  <entry><title>Primeira noticia</title><content type="html"><![CDATA[<p>Texto com <b>negrito</b> dentro]]></content></entry>\n' +
          '  <entry><title>Segunda noticia</title><content type="html"><![CDATA[<p>Outro texto &amp; entidade</p>]]></content></entry>\n' +
          "</feed>\n"
      );
      return;
    }

    // BUG-3: pagina SSR rica (conteudo completo no HTML) QUE TAMBEM carrega o
    // marcador __NEXT_DATA__. read_dynamic_page nao pode trocar o texto
    // completo pelo dump de JSON.
    if (path === "/ssr-rico") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>SSR Rico</title></head><body>" +
          "<h1>Documentacao</h1>" +
          "<p>" + "Conteudo estatico completo. ".repeat(30) + "</p>" +
          "<pre><code>def soma(a, b):\n    return a + b\n</code></pre>" +
          "<p>Mais texto depois do codigo. " + "Explicacao detalhada. ".repeat(20) + "</p>" +
          '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"titulo":"Produto X"}}}</script>' +
          "</body></html>"
      );
      return;
    }

    // BUG-5: SPA pura — casca vazia, nada de texto estatico.
    if (path === "/vazia") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        '<!DOCTYPE html><html><head><title>App</title><meta name="description" content="Um app"></head><body>' +
          '<div id="root"></div><script src="/app.js"></script></body></html>'
      );
      return;
    }

    // BUG-6: 403 definitivo, com contador — retry aparece como contagem > 1.
    if (path === "/negado") {
      contagem.set("/negado", (contagem.get("/negado") || 0) + 1);
      res.writeHead(403, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><body>proibido</body></html>");
      return;
    }

    // BUG-7: pagina no estilo GitHub — numeros de linha e a estatistica
    // duplicada marcados como aria-hidden (enfeite para leitor de tela).
    if (path === "/github-like") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>repo/arquivo.js</title></head><body>" +
          '<div class="alerta">Skip to content</div>' +
          "<h1>arquivo.js</h1>" +
          '<div class="filemeta"><span aria-hidden="true">17 lines (17 loc) · 710 Bytes</span>' +
          "<span>17 lines (17 loc) · 710 Bytes</span></div>" +
          '<table><tr><td aria-hidden="true">1</td><td>const a = 1;</td></tr>' +
          '<tr><td aria-hidden="true">2</td><td>const b = 2;</td></tr></table>' +
          "</body></html>"
      );
      return;
    }

    // BUG-8: <pre> onde cada linha de codigo vem no proprio elemento (estilo
    // react.dev) — o parser explodia linhas em branco entre as linhas.
    if (path === "/react-like") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>React Like</title></head><body>" +
          "<h1>Exemplo</h1>" +
          "<pre><code>" +
          '<div class="line">function Soma() {</div>\n' +
          '<div class="line">  return 1 + 1;</div>\n' +
          "<div>}</div>\n" +
          "</code></pre></body></html>"
      );
      return;
    }

    // BUG-7 (regressao da propria correcao): <img aria-hidden="true"> decorativo
    // (tag VOID) fez skipDepth travar acima de zero e engoliu o resto da
    // pagina — aconteceu de verdade com o logo da Wikipedia.
    if (path === "/aria-void") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>Logo e artigo</title></head><body>" +
          '<img src="/logo.png" alt="" aria-hidden="true">' +
          "<h1>Manual do produto</h1>" +
          "<p>Primeiro paragrafo depois do logo decorativo, com texto bastante.</p>" +
          "<p>Segundo paragrafo, ainda mais texto para passar da marca de 300.</p>" +
          "</body></html>"
      );
      return;
    }

    // BUG-9: <script> SELF-CLOSING (<script .../>), saida comum de template
  // XHTML. extractLinks nao tinha a guarda de selfClosing que o BUG-7 pos
  // em htmlToMarkdown: skipDepth subia e nunca descia, e TODOS os links
  // depois do script desapareciam (extract_links, discover_urls e o
  // crawl_site compartilham o extractLinks).
  if (path === "/skip-self") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      '<!DOCTYPE html><html><head><title>Self Closing</title><script src="/app.js"/></head><body>' +
        "<h1>Pagina</h1><p>texto antes dos links</p>" +
        '<p><a href="/alvo-1">Alvo um</a></p><p><a href="/alvo-2">Alvo dois</a></p>' +
        "</body></html>"
    );
    return;
  }

  // Controle do BUG-9: o mesmo <script>, fechado do jeito normal. Os links
  // depois dele TEM de aparecer — esse caso sempre funcionou.
  if (path === "/skip-open") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      '<!DOCTYPE html><html><head><title>Script Fechado</title><script src="/app.js"></script></head><body>' +
        "<h1>Pagina</h1><p>texto antes dos links</p>" +
        '<p><a href="/alvo-1">Alvo um</a></p><p><a href="/alvo-2">Alvo dois</a></p>' +
        "</body></html>"
    );
    return;
  }

  // BUG-9, variante <svg/>: icone inline self-closing, mesma armadilha.
  if (path === "/skip-svg") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      '<!DOCTYPE html><html><head><title>Svg Self</title></head><body>' +
        '<svg width="16" height="16" aria-hidden="true"/><h1>Pagina</h1>' +
        '<p><a href="/alvo-1">Alvo um</a></p><p><a href="/alvo-2">Alvo dois</a></p>' +
        "</body></html>"
    );
    return;
  }

  // BUG-2: CDATA dentro de HTML — o ]]> vazava como texto visivel.
    if (path === "/cdata") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>CDATA</title></head><body>" +
          "<h1>Feed</h1><p><![CDATA[Texto com <marcacao> dentro]]></p>" +
          "</body></html>"
      );
      return;
    }

    // ---- fixtures do robots.txt ----

    // /robots.txt: conta os hits (o servidor so pode buscar UMA vez por
    // origem dentro do TTL) e serve as regras — ou falha, no modo "erro500"
    // (fail-open: sem regra para cumprir, nada a bloquear).
    if (path === "/robots.txt") {
      contagem.set("/robots.txt", (contagem.get("/robots.txt") || 0) + 1);
      if (robots === "erro500") {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("falhou");
        return;
      }
      if (robots === "estaciona") {
        // Manda os cabecalhos e um pedaco do corpo, e NUNCA termina: e o caso
        // que prendia a busca do robots.txt (e a vaga de admissao da
        // requisicao) para sempre — o teto tem de cobrir a leitura do corpo.
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.write("User-agent: *\n");
        return;
      }
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(
        "User-agent: *\n" +
          "Disallow: /privado\n" +
          "Allow: /privado/publico\n" +
          "Disallow: /*/curinga\n" +
          "Disallow: /termo$\n"
      );
      return;
    }

    const paginaMarcador = (marcador) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<!DOCTYPE html><html><head><title>${marcador}</title></head><body>` +
          `<h1>${marcador}</h1><p>texto de enchimento para passar da marca de 300.</p></body></html>`
      );
    };

    if (path.startsWith("/privado/")) {
      if (path === "/privado/publico") return paginaMarcador("MARCADO-PUBLICO");
      return paginaMarcador("MARCADO-PRIVADO");
    }
    if (path === "/coisa/curinga") return paginaMarcador("MARCADO-CURINGA");
    if (path === "/termo") return paginaMarcador("MARCADO-TERMO");
    if (path === "/termo-extra") return paginaMarcador("MARCADO-TERMO-EXTRA");
    if (path === "/livre") return paginaMarcador("MARCADO-LIVRE");

    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(FIXTURE_HTML);
  });
  // Escuta em TODAS as interfaces IPv4: o mesmo fixture atende 127.0.0.1 e
  // 127.0.0.2 — dois "hosts" distintos para os testes de limite por host,
  // sem passar por "localhost" (que no Windows paga tentativas IPv6 antes
  // de cair no IPv4).
  await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    // Variante com outro LOOPBACK (127.0.0.2 e valido): mesma porta, "host"
    // diferente para os limites por host dos testes. Evita "localhost", que
    // no Windows paga tentativas IPv6 antes de cair no IPv4.
    urlAlt: `http://127.0.0.2:${port}`,
    probes,
    clearProbes: () => {
      probes.length = 0;
    },
    contagemDe: (caminho) => contagem.get(caminho) || 0,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// Sobe o servidor MCP em modo HTTP numa porta livre e espera o /health.
export async function startMcp(env = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER_PATH, "--http"], {
    env: {
      ...process.env,
      PORT: String(port),
      MCP_AUTH_TOKEN: TOKEN,
      ALLOW_PRIVATE_HOSTS: "", // bloqueio LIGADO por padrao nos testes
      TRUST_PROXY_HOPS: "0", // padrao de producao
      ...env,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) break;
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) {
        up = true;
        break;
      }
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!up) {
    child.kill();
    throw new Error(`servidor MCP nao subiu.\n${stderr}`);
  }

  // Chamada JSON-RPC crua (usada pelos testes de rate limit).
  const raw = async (body, headers = {}) => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, ...headers },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  // Chamada de ferramenta: devolve sempre { isError, text }.
  const call = async (name, args, headers = {}) => {
    const { json } = await raw(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
      headers
    );
    return {
      isError: Boolean(json && json.result && json.result.isError),
      text: (json && json.result && json.result.content && json.result.content[0].text) || JSON.stringify(json),
    };
  };

  return {
    base,
    call,
    raw,
    stderr: () => stderr,
    close: () => child.kill(),
  };
}

/* ------------------------------ utilidades ------------------------------ */

// Le o uso do cache no /health: { entries, bytes, maxBytes }.
export async function cacheInfo(mcp) {
  const res = await fetch(`${mcp.base}/health`);
  const text = await res.text();
  const m = text.match(/cache:\s*(\d+)\s*entradas,\s*(\d+)\s*bytes\s*\/\s*(\d+)\s*bytes/);
  if (!m) throw new Error(`nao consegui ler o cache do /health: ${text}`);
  return { entries: Number(m[1]), bytes: Number(m[2]), maxBytes: Number(m[3]), raw: text };
}

// Extrai os blocos de codigo cercados do markdown.
export function blocosDeCodigo(markdown) {
  return [...markdown.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1]);
}

// Extrai as tabelas markdown (linha de cabecalho + separador + linhas).
export function tabelas(markdown) {
  const linhas = markdown.split("\n");
  const encontradas = [];
  for (let i = 1; i < linhas.length; i++) {
    if (/^\|\s*-{3,}/.test(linhas[i]) && /^\|/.test(linhas[i - 1] || "")) {
      const grupo = [linhas[i - 1], linhas[i]];
      let j = i + 1;
      while (j < linhas.length && /^\|/.test(linhas[j])) grupo.push(linhas[j++]);
      encontradas.push(grupo);
    }
  }
  return encontradas;
}

// Conta as celulas de uma linha de tabela, ignorando os "|" escapados.
export function celulas(linha) {
  return linha
    .replace(/\\\|/g, "\u0000")
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.replace(/\u0000/g, "\\|"));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
