// Infraestrutura dos testes: sobe um servidor de fixture (paginas locais) e o
// servidor MCP de verdade, em modo HTTP, numa porta livre.
//
// Nada aqui e um caso de teste — por isso este arquivo mora em `tests/` (e nao
// em `test/`), para o `node --test` nao tentar executa-lo como teste.
import { spawn } from "node:child_process";
import http from "node:http";
import zlib from "node:zlib";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// TEST_SERVER_PATH permite apontar a suite para outra copia do servidor
// (usado para conferir que os testes realmente falham contra a versao antiga).
export const SERVER_PATH = process.env.TEST_SERVER_PATH || join(__dirname, "..", "server.js");
export const TOKEN = "token-de-teste";

// Monta um PDF minimo, porem VALIDO, com um content stream comprimido em
// FlateDecode: operadores de texto de verdade (BT/ET, Tf, TD, Tj, TJ) para o
// extrator do projeto ter o que ler. Usa zlib (ja importado) para comprimir.
export function construirPdfFixture() {
  // Duas linhas por Tj; um TJ com ajuste negativo grande (espaco entre
  // palavras); um Td com ty != 0 (nova linha).
  // Um paragrafo de enchimento alem das linhas fixas, para o teste de
  // truncamento ter o que cortar (o minimo de maxChars e 200).
  let enchimento = "";
  for (let i = 1; i <= 6; i++) {
    enchimento += `0 -18 Td\n(Linha de enchimento numero ${i} com bastante texto para passar da marca de duzentos caracteres.) Tj\n`;
  }
  const conteudo =
    "BT\n/F1 12 Tf\n72 720 Td\n" +
    "(Relatorio de teste do leitor de PDF) Tj\n" +
    "0 -18 Td\n" +
    "[(Texto) -300 (com) -300 (espacos) -300 (reconstruidos)] TJ\n" +
    "0 -18 Td\n" +
    "(Segunda linha do documento.) Tj\n" +
    enchimento +
    "ET\n";
  const comprimido = zlib.deflateSync(Buffer.from(conteudo, "latin1"));

  const objetos = [];
  objetos.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objetos.push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  objetos.push(
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n"
  );
  const cabecalhoStream = `4 0 obj\n<< /Length ${comprimido.length} /Filter /FlateDecode >>\nstream\n`;
  const rodapeStream = "\nendstream\nendobj\n";
  objetos.push(cabecalhoStream + comprimido.toString("latin1") + rodapeStream);
  objetos.push("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");

  let corpo = "%PDF-1.4\n";
  const offsets = [];
  for (const obj of objetos) {
    offsets.push(corpo.length);
    corpo += obj;
  }
  const inicioXref = corpo.length;
  corpo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    corpo += String(off).padStart(10, "0") + " 00000 n \n";
  }
  corpo += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;
  return Buffer.from(corpo, "latin1");
}

// Monta um ZIP minimo para os fixtures de DOCX/PPTX/EPUB.
//
// Metodo "armazenado" (sem compressao) e CRC zerado: o leitor do servidor
// aceita metodo 0 e nao confere CRC. O teste quer provar a extracao do TEXTO,
// nao o descompactador — e nao vale carregar uma dependencia so para o fixture.
export function construirZip(entradas) {
  const partesLocais = [];
  const partesCentrais = [];
  let deslocamento = 0;

  for (const [nome, conteudo] of Object.entries(entradas)) {
    const nomeBuf = Buffer.from(nome, "utf8");
    const dados = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo, "utf8");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(dados.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nomeBuf.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(dados.length, 20);
    central.writeUInt32LE(dados.length, 24);
    central.writeUInt16LE(nomeBuf.length, 28);
    central.writeUInt32LE(deslocamento, 42);

    partesLocais.push(local, nomeBuf, dados);
    partesCentrais.push(central, nomeBuf);
    deslocamento += local.length + nomeBuf.length + dados.length;
  }

  const tamanhoCentral = partesCentrais.reduce((soma, parte) => soma + parte.length, 0);
  const total = Object.keys(entradas).length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(total, 8);
  eocd.writeUInt16LE(total, 10);
  eocd.writeUInt32LE(tamanhoCentral, 12);
  eocd.writeUInt32LE(deslocamento, 16);

  return Buffer.concat([...partesLocais, ...partesCentrais, eocd]);
}

export function construirDocxFixture() {
  const documento =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    "<w:p><w:r><w:t>Relatorio de teste</w:t></w:r></w:p>" +
    "<w:p><w:r><w:t>Primeiro paragrafo do documento.</w:t></w:r></w:p>" +
    "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Celula A</w:t></w:r></w:p></w:tc>" +
    "<w:tc><w:p><w:r><w:t>Celula B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>" +
    "</w:body></w:document>";
  const props =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">' +
    "<dc:title>Contrato de teste</dc:title>" +
    "<dc:creator>Equipe Fixture</dc:creator>" +
    "<dcterms:modified>2026-10-20T10:00:00Z</dcterms:modified>" +
    "</cp:coreProperties>";
  return construirZip({ "word/document.xml": documento, "docProps/core.xml": props });
}

export function construirPptxFixture() {
  const slide = (texto) =>
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    "<p:cSld><p:spTree><p:sp><p:txBody>" +
    `<a:p><a:r><a:t>${texto}</a:t></a:r></a:p>` +
    "</p:txBody></p:sp></p:spTree></p:cSld></p:sld>";
  // De proposito, a ORDEM da apresentacao aponta rId1 -> slide2 e
  // rId2 -> slide1: so a leitura das relacoes devolve "Slide 1" = slide dois.
  const apresentacao =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst>' +
    "</p:presentation>";
  const relacoes =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>' +
    "</Relationships>";
  return construirZip({
    "ppt/presentation.xml": apresentacao,
    "ppt/_rels/presentation.xml.rels": relacoes,
    "ppt/slides/slide1.xml": slide("Conteudo do slide um"),
    "ppt/slides/slide2.xml": slide("Conteudo do slide dois"),
  });
}

export function construirEpubFixture() {
  const container =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">' +
    '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>' +
    "</container>";
  const opf =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0">' +
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    "<dc:title>Livro de teste</dc:title><dc:creator>Autora Fixture</dc:creator>" +
    "<dc:date>2026-10-01</dc:date></metadata>" +
    '<manifest><item id="c1" href="cap1.xhtml" media-type="application/xhtml+xml"/>' +
    '<item id="c2" href="cap2.xhtml" media-type="application/xhtml+xml"/></manifest>' +
    '<spine><itemref idref="c2"/><itemref idref="c1"/></spine></package>';
  const capitulo = (titulo, texto) =>
    `<!DOCTYPE html><html><head><title>${titulo}</title></head><body>` +
    `<h1>${titulo}</h1><p>${texto}</p><p><a href="cap1.xhtml">Link interno</a></p></body></html>`;
  return construirZip({
    "META-INF/container.xml": container,
    "OEBPS/content.opf": opf,
    "OEBPS/cap1.xhtml": capitulo("Capitulo um", "Texto do primeiro capitulo."),
    "OEBPS/cap2.xhtml": capitulo("Capitulo dois", "Texto do segundo capitulo."),
  });
}

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
//   /video/com-track            -> pagina com <video> + <track> -> /video/legenda.vtt
//   /video/legenda.vtt          -> legenda WebVTT de verdade (3 falas)
//   /video/legenda-bloqueada    -> pagina cujo <track> aponta para /privado/* (robots)
//   /video/sem-video            -> pagina HTML comum, sem sinal nenhum de video
export async function startFixture({ robots = "regras" } = {}) {
  // Contador de requisicoes por id: deixa visivel de FORA se a resposta veio do
  // cache (mesmo contador) ou foi baixada de novo (contador maior).
  const hits = new Map();
  // Contador por caminho (usado pelos testes de retry: 403 definitivo tem de
  // bater no servidor UMA vez so).
  const contagem = new Map();
  // Candidatos "/api/..." que o servidor realmente buscou (ordem de chegada).
  const probes = [];
  // Estatisticas dos fluxos escritos aos poucos (so o /cedo usa): prova, do
  // lado do SERVIDOR, quanto do corpo foi realmente enviado antes do cliente
  // desconectar.
  const fluxo = new Map();

  const server = http.createServer((req, res) => {
    const path = String(req.url || "/");

    // /etag?tag=X -> pagina que emite ETag e honra If-None-Match: bate no
    // contador de hits para dar para provar se houve download ou 304. Serve
    // para testar a revalidacao condicional do fetch.
    if (path.startsWith("/etag")) {
      const u = new URL(path, "http://local");
      const tag = u.searchParams.get("tag") || '"v1"';
      const id = `etag:${tag}`;
      const n = (hits.get(id) || 0) + 1;
      hits.set(id, n);
      if (req.headers["if-none-match"] === tag) {
        res.writeHead(304, { etag: tag });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", etag: tag });
      res.end(
        "<!DOCTYPE html><html><head><title>Etag</title></head><body>" +
          `<h1>Etag ${tag}</h1><p>${"x".repeat(600)}</p></body></html>`
      );
      return;
    }

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

    // /erro-502-uma-vez -> 502 na primeira requisicao e 200 depois. Prova que
    // 502/504 entram no retry (antes so 429/500/503 eram repetidos).
    if (path === "/erro-502-uma-vez") {
      const n = (contagem.get(path) || 0) + 1;
      contagem.set(path, n);
      if (n === 1) {
        res.writeHead(502, { "content-type": "text/html; charset=utf-8" });
        res.end("<html><body>502</body></html>");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>Depois do 502</title></head><body>" +
          "<h1>Depois do 502</h1><p>texto de enchimento para passar da marca de 300 caracteres deste caso.</p></body></html>"
      );
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
    // /crawl/so-erros -> 10 links que falham. O maxPages tem de limitar
    // TENTATIVAS, nao so leituras bem-sucedidas: com links todos quebrados,
    // contar apenas sucessos deixava o crawl baixar os 10.
    if (path === "/crawl/so-erros") {
      const links = Array.from({ length: 10 }, (_, i) => `<a href="/crawl/quebrado-${i}">quebrado ${i}</a>`).join("");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html><html><head><title>So erros</title></head><body><h1>So erros</h1>${links}</body></html>`);
      return;
    }
    if (path.startsWith("/crawl/quebrado-")) {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><body>404</body></html>");
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

    // /quente -> pagina pequena e estavel, com contador por caminho. O teste
    // do aquecedor le duas vezes (as duas do cache) e espera a rodada de fundo
    // revalidar sozinha: o contador tem de subir SEM pedido de cliente novo.
    if (path === "/quente") {
      contagem.set(path, (contagem.get(path) || 0) + 1);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>Quente</title></head><body>" +
          `<h1>MARCADO-QUENTE</h1><p>${"conteudo quente ".repeat(60)}</p></body></html>`
      );
      return;
    }

    // /baus -> guia de jogo com secoes sobre baus e uma secao de outro
    // assunto. A busca por relevancia tem de achar os trechos de bau (mesmo
    // com a consulta sem acento) e deixar "Combate" de fora.
    if (path === "/baus") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>Guia de Baus</title></head><body>" +
          "<h1>Guia do Jogo</h1>" +
          "<p>Um guia completo com mapas, itens e estrategias para terminar o jogo.</p>" +
          "<h2>Localização dos Baús</h2>" +
          "<p>Os baús ficam espalhados pelo mapa. O primeiro baú fica perto da vila inicial, atrás da casa do ferreiro.</p>" +
          "<p>O segundo baú fica na caverna ao norte; para abrir, use a chave dourada.</p>" +
          "<h2>Baús da Floresta</h2>" +
          "<p>Na floresta existem três baús escondidos entre as árvores. O baú de madeira tem moedas; o baú de prata tem uma espada; o baú dourado tem a armadura.</p>" +
          "<table><thead><tr><th>Baú</th><th>Localização</th><th>Recompensa</th></tr></thead>" +
          "<tbody><tr><td>Baú de madeira</td><td>Floresta, atrás da ponte</td><td>Moedas</td></tr>" +
          "<tr><td>Baú de prata</td><td>Caverna do norte</td><td>Espada</td></tr>" +
          "<tr><td>Baú dourado</td><td>Torre do castelo</td><td>Armadura</td></tr></tbody></table>" +
          "<h2>Combate</h2>" +
          "<p>Aprenda a esquivar e contra-atacar. A espada e o escudo sao essenciais nas primeiras batalhas.</p>" +
          "</body></html>"
      );
      return;
    }

    // /tarde -> o TEXTO so aparece depois de ~480 KB de comentarios. Com
    // maxChars de 1000, o primeiro marco (256 KB) nao cobre o pedido e o MESMO
    // download continua ate o fim (~535 KB) — antes, essa leitura pagava duas
    // conexoes (o pedaco de 256 KB e o refazer largo). O contador prova que
    // agora e UMA requisicao, e o cache guarda o documento inteiro.
    if (path === "/tarde") {
      contagem.set(path, (contagem.get(path) || 0) + 1);
      const comentarios = "<!-- " + "z".repeat(480 * 1024) + " -->";
      const blocos = Array.from(
        { length: 260 },
        (_, i) => `<p>MARCADO-TARDE paragrafo ${i} ${"conteudo ".repeat(20)}</p>`
      ).join("");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<!DOCTYPE html><html><head><title>Tarde</title></head><body>` +
          `${comentarios}<h1>MARCADO-TARDE</h1>${blocos}</body></html>`
      );
      return;
    }

    // /cedo -> o TEXTO vem primeiro e o rabo e um fluxo LONGO e lento (~8 MB em
    // blocos de 2 KB a cada 1 ms). Com maxChars de 1000 o download tem de
    // parar no primeiro marco (256 KB) e desconectar: `enviados` registra, do
    // lado do servidor, que o rabo nao foi baixado, e `concluiu` diz se o
    // fixture chegou a escrever tudo (nao pode).
    if (path === "/cedo") {
      contagem.set(path, (contagem.get(path) || 0) + 1);
      const inicio =
        "<!DOCTYPE html><html><head><title>Cedo</title></head><body>" +
        "<h1>MARCADO-CEDO</h1><p>" + "texto ".repeat(20000) + "</p>";
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.write(inicio);
      let enviados = Buffer.byteLength(inicio);
      let fechado = false;
      let concluiu = false;
      res.on("error", () => {});
      res.on("close", () => {
        fechado = true;
        fluxo.set("cedo", { enviados, fechado: true, concluiu });
      });
      let i = 0;
      const escrever = () => {
        if (fechado) return;
        if (i >= 4000) {
          concluiu = true;
          res.end("</body></html>");
          return;
        }
        const bloco = "<!-- " + "z".repeat(2040) + " -->";
        enviados += bloco.length;
        try {
          res.write(bloco);
        } catch {
          fechado = true;
          return;
        }
        i++;
        setTimeout(escrever, 1);
      };
      escrever();
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

    // /gzip e /br -> pagina comprimida de verdade: o transporte de saída tem
    // de descomprimir sozinho (o fetch global fazia isso de graça; o pinado
    // precisa fazer explícito).
    if (path === "/gzip" || path === "/br") {
      const corpo = Buffer.from(
        "<!DOCTYPE html><html><head><title>Comprimida</title></head><body>" +
          "<h1>MARCADO-COMPRIMIDA</h1><p>texto de enchimento para passar da marca de 300 caracteres deste caso.</p></body></html>"
      );
      const buffer = path === "/gzip" ? zlib.gzipSync(corpo) : zlib.brotliCompressSync(corpo);
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-encoding": path === "/gzip" ? "gzip" : "br",
      });
      res.end(buffer);
      return;
    }

    // /redir-cuspe -> 302 que manda os cabecalhos, cospe um pedaco do corpo e
    // NUNCA termina. Drenar o corpo do redirect por inteiro pendurava o salto
    // (e a vaga de admissao); agora o corpo e descartado na hora.
    if (path === "/redir-cuspe") {
      res.writeHead(302, { location: "/pagina" });
      res.write("lixo".repeat(500));
      return; // nunca res.end()
    }

    // /erro-cuspe -> 404 que manda cabecalhos, cospe corpo e NUNCA termina:
    // o descarte do corpo de erro tem de ser imediato (sem drenar).
    if (path === "/erro-cuspe") {
      res.writeHead(404, { "content-type": "text/html" });
      res.write("lixo".repeat(1000));
      return; // nunca res.end()
    }

    // /porcento -> links com percent-encoding malformado ("/100%", "/perfil%zz").
    // O decodeURIComponent do filtro de navegacao lancava URIError e derrubava
    // o crawl inteiro; agora os links passam intactos.
    if (path === "/porcento") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>Porcento</title></head><body><h1>Links esquisitos</h1>" +
          '<p><a href="/100%">porcento solto</a></p>' +
          '<p><a href="/perfil%zz">zz solto</a></p>' +
          "</body></html>"
      );
      return;
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

    // Redirect para uma URL com credenciais embutidas: o salto seguinte seria
    // baixado SEM elas, e o finalUrl as levaria para a resposta.
    if (path === "/redirect-credenciais") {
      res.writeHead(302, { location: `http://usuario:senha-do-redirect@127.0.0.1:${server.address().port}/pagina` });
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

    // /sitemap.xml -> sitemap com `&amp;` (que precisa ser decodificado) e uma
    // URL repetida (que nao pode inflar a contagem nem consumir o limit).
    if (path === "/sitemap.xml") {
      res.writeHead(200, { "content-type": "application/xml; charset=utf-8" });
      res.end(
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
          "  <url><loc>https://exemplo.org/busca?a=1&amp;b=2</loc></url>\n" +
          "  <url><loc>https://exemplo.org/duplicada</loc></url>\n" +
          "  <url><loc>https://exemplo.org/duplicada</loc></url>\n" +
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

    // /casca -> casca de JavaScript com MIGALHAS de texto estatico (o titulo e o
    // link de login), exatamente o que a pagina real que motivou este caso
    // devolvia: 95 caracteres. O aviso antigo so disparava com 0 caracteres,
    // entao isto saia como se fosse a pagina toda.
    // O enchimento nao e enfeite: uma casca de verdade traz o CSS e o estado
    // dentro do proprio HTML, e o documento chega a centenas de KB. Sem ele o
    // fixture nao tinha o tamanho que a regra exige, e o teste passava por um
    // motivo falso.
    if (path === "/casca") {
      const estoque = "<style>" + ".grelha > *{display:grid;gap:1rem;}.card{padding:.5rem 1rem;}".repeat(200) + "</style>";
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        '<!DOCTYPE html><html><head><title>Casca</title>' + estoque + "</head><body>" +
          '<div class="topo"><h1><a href="/">Casca de JS</a></h1><p>Login</p></div>' +
          '<div class="grelha"></div>' +
          '<script src="/app.js"></script><script>/* monta as caixas no cliente */</script>' +
          "</body></html>"
      );
      return;
    }

    // /casca-pequena -> o quotes.toscrape.com/js real: 5,8 KB de HTML com
    // jQuery e um script que monta a lista, e 95 caracteres de texto (o h1 e
    // o link de login). Nao passa do piso de 8 KB, entao e o caso que prova
    // que a regra e a desproporcao, nao o tamanho absoluto.
    if (path === "/casca-pequena") {
      const jquery =
        "<script>" + "/* jquery-like: cada linha so serve para ocupar bytes como um bundle real */\n".repeat(60) + "</script>";
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        '<!DOCTYPE html><html><head><title>Quotes to Scrape</title>' + jquery + "</head><body>" +
          '<div class="container"><h1><a href="/">Quotes to Scrape</a></h1>' +
          '<p><a href="/login">Login</a></p><div class="quotes"></div></div>' +
          '<script src="/static/quotes.js"></script>' +
          "</body></html>"
      );
      return;
    }

    // /analitico -> pagina CURTA que TEM um script (so um beacon externo, como
    // o example.com traz). Foi o falso positivo que so apareceu no ar: o texto
    // entregue e a pagina toda, mas um teste que olha apenas "tem <script>?"
    // chama-lhe casca e manda o cliente procurar noutro lado a toa.
    if (path === "/analitico") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        '<!DOCTYPE html><html><head><title>Curta com analitico</title></head><body>' +
          "<h1>Dominio de exemplo</h1><p>Esta pagina e pequena, completa, e carrega um script de medicao.</p>" +
          '<script src="/s.js"></script></body></html>'
      );
      return;
    }

    // /pequena -> pagina CURTA mas de texto de verdade, sem um script nenhum.
    // O contraste que a /casca precisa: tamanho sozinho nao e sinal de casca,
    // senao toda pagina pequena receberia o aviso de JavaScript.
    if (path === "/pequena") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        '<!DOCTYPE html><html><head><title>Pequena</title></head><body>' +
          "<h1>Pagina Pequena</h1><p>Esta pagina e pequena e nao tem scripts.</p>" +
          "</body></html>"
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

    // /pre-inline -> marcação inline DENTRO de <pre>. strong/em viravam **
    // dentro do bloco de código, e <a> virava sintaxe de link markdown.
    if (path === "/pre-inline") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>Pre inline</title></head><body>" +
          "<pre><code>const total = <strong>1</strong> + <em>2</em>;\n" +
          'Veja <a href="/alvo">o alvo</a> aqui.\n</code></pre>' +
          "</body></html>"
      );
      return;
    }

    // /links-esquisitos -> links que nao sao http(s). Eles nao abrem nada e
    // nao podem aparecer na lista (blob:, about:).
    if (path === "/links-esquisitos") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>Links esquisitos</title></head><body>" +
          '<p><a href="blob:https://exemplo.org/123">blob</a></p>' +
          '<p><a href="about:blank">about</a></p>' +
          '<p><a href="/alvo">alvo normal</a></p>' +
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

    // ---- fixtures do read_video ----

    // Legenda WebVTT de verdade: outro caminho de transcricao do read_video
    // roda por aqui (pagina -> <track> -> legenda -> blocos com timestamp).
    if (path === "/video/legenda.vtt") {
      res.writeHead(200, { "content-type": "text/vtt; charset=utf-8" });
      res.end(
        "WEBVTT\n\n" +
          "1\n00:00:01.000 --> 00:00:03.000\nBem-vindo ao video de teste.\n\n" +
          "2\n00:00:03.000 --> 00:00:06.000\nEsta e a segunda fala da legenda.\n\n" +
          "3\n00:00:06.000 --> 00:00:09.500\nTerceira e ultima fala do fixture.\n"
      );
      return;
    }

    // Pagina com <video> + <track>: o caminho generico (qualquer plataforma)
    // do read_video — metadados por og tags e transcricao pela legenda ao lado.
    if (path === "/video/com-track") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>Pagina com video</title>" +
          '<meta property="og:title" content="Documentario de teste">' +
          '<meta property="og:description" content="Um video de fixture para os testes.">' +
          '<meta property="og:type" content="video.other">' +
          "</head><body><h1>Assista</h1>" +
          '<video controls poster="/capa.jpg"><source src="/video/clipe.mp4" type="video/mp4">' +
          '<track kind="subtitles" src="/video/legenda.vtt" srclang="pt" label="Portugues">' +
          "</video></body></html>"
      );
      return;
    }

    // Mesma pagina, mas o <track> aponta para /privado/* — caminho que o
    // robots.txt do fixture bloqueia (Disallow: /privado). A leitura tem de
    // devolver os metadados e avisar que a transcricao foi bloqueada.
    if (path === "/video/legenda-bloqueada") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>Bloqueada</title>" +
          '<meta property="og:title" content="Video com legenda bloqueada">' +
          '<meta property="og:type" content="video.other">' +
          "</head><body><video controls>" +
          '<track kind="subtitles" src="/privado/video.vtt" srclang="pt" label="Portugues">' +
          "</video></body></html>"
      );
      return;
    }

    // Pagina comum, sem sinal nenhum de video: o read_video tem de dizer que
    // nao identificou video e apontar o read_page.
    if (path === "/video/sem-video") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>Texto</title></head><body>" +
          "<h1>Noticia</h1><p>Uma pagina normal, sem video embutido.</p></body></html>"
      );
      return;
    }

    // ---- fixtures do read_pdf ----
    // PDF de verdade, montado aqui com zlib: content stream com operadores
    // Tj/TD/TJ, comprimido em FlateDecode. Serve para provar a extracao e a
    // reconstrucao de espacos/quebras sem depender de rede nem de arquivo
    // binario no repositorio.
    if (path === "/pdf/simples.pdf") {
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end(construirPdfFixture());
      return;
    }
    // Corpo que NAO e PDF (para o caminho "nao reconhecido").
    if (path === "/pdf/nao-pdf.pdf") {
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end("%NAO-E-PDF\nisto aqui nao e um pdf de verdade.\n");
      return;
    }

    // ---- fixtures do read_feed ----
    if (path === "/feed/rss.xml") {
      res.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
      res.end(
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<rss version="2.0"><channel>' +
          "<title>Blog de Teste</title>" +
          "<description>Um feed para os testes</description>" +
          "<item>" +
          "<title>Primeiro post</title>" +
          "<link>https://exemplo.com/primeiro</link>" +
          '<pubDate>Tue, 14 Oct 2026 12:00:00 GMT</pubDate>' +
          "<author>autor@exemplo.com (Fulano)</author>" +
          "<description>Resumo do primeiro post.</description>" +
          "</item>" +
          "<item>" +
          "<title><![CDATA[Segundo <b>post</b>]]></title>" +
          "<link>https://exemplo.com/segundo</link>" +
          "<description><![CDATA[<p>Resumo com <b>HTML</b> dentro.</p>]]></description>" +
          "</item>" +
          "</channel></rss>"
      );
      return;
    }
    if (path === "/feed/atom.xml") {
      res.writeHead(200, { "content-type": "application/atom+xml; charset=utf-8" });
      res.end(
        '<?xml version="1.0" encoding="utf-8"?>\n' +
          '<feed xmlns="http://www.w3.org/2005/Atom">' +
          "<title>Atom de Teste</title>" +
          "<subtitle>Feed Atom para os testes</subtitle>" +
          "<entry>" +
          "<title>Entrada um</title>" +
          '<link rel="alternate" href="https://exemplo.com/um"/>' +
          "<published>2026-10-14T12:00:00Z</published>" +
          "<author><name>Beltrano</name></author>" +
          "<summary>Resumo da entrada um.</summary>" +
          "</entry>" +
          "</feed>"
      );
      return;
    }
    if (path === "/feed/jsonfeed.json") {
      res.writeHead(200, { "content-type": "application/feed+json; charset=utf-8" });
      res.end(
        JSON.stringify({
          version: "https://jsonfeed.org/version/1.1",
          title: "JSON Feed de Teste",
          items: [
            { id: "1", title: "Item do JSON Feed", url: "https://exemplo.com/j1", content_text: "Resumo do item." },
          ],
        })
      );
      return;
    }
    // Pagina HTML que ANUNCIA um feed (para o caminho "nao e feed, mas aponta um").
    if (path === "/feed/pagina.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>Pagina com feed</title>" +
          '<link rel="alternate" type="application/rss+xml" href="https://exemplo.com/feed.xml">' +
          "</head><body><h1>Blog</h1></body></html>"
      );
      return;
    }

    // ---- fixture do diff_page ----
    // Conteudo MUDA a cada leitura: e assim que se prova o diff sem esperar
    // um site de verdade mudar. /diff/muda -> contador; /diff/estavel -> igual.
    if (path === "/diff/muda") {
      const n = (hits.get("/diff/muda") || 0) + 1;
      hits.set("/diff/muda", n);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>Pagina que muda</title></head><body>" +
          "<h1>Titulo estavel</h1>" +
          "<p>Paragrafo que nunca muda.</p>" +
          `<p>Versao ${n}</p>` +
          "</body></html>"
      );
      return;
    }
    if (path === "/diff/estavel") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>Pagina estavel</title></head><body>" +
          "<h1>Conteudo fixo</h1><p>Nada muda aqui.</p>" +
          "</body></html>"
      );
      return;
    }

    // ---- fixtures do read_json ----
    if (path === "/json/simples.json") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ nome: "Teste", total: 2, data: { items: [{ id: 1 }, { id: 2 }] } }));
      return;
    }
    if (path === "/json/invalido.json") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end("{ isto nao e json ");
      return;
    }

    // ---- fixtures das ferramentas de dados e documentos ----

    // /info -> metadados por <meta>, JSON-LD de artigo e canonical.
    if (path === "/info") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        '<!DOCTYPE html><html lang="pt-BR"><head>' +
          "<title>Titulo da Meta | Site Fixture</title>" +
          '<meta name="description" content="Uma descricao de teste com detalhes.">' +
          '<meta name="author" content="Fulana de Tal">' +
          '<meta property="article:published_time" content="2026-10-01T09:00:00Z">' +
          '<meta property="article:modified_time" content="2026-10-02T10:30:00Z">' +
          '<meta property="og:site_name" content="Site Fixture">' +
          '<link rel="canonical" href="/info">' +
          '<script type="application/ld+json">' +
          '{"@context":"https://schema.org","@type":"NewsArticle","headline":"Titulo Estruturado",' +
          '"author":{"@type":"Person","name":"Fulana de Tal"},"datePublished":"2026-10-01T09:00:00Z"}' +
          "</script></head><body><h1>Noticia</h1><p>Corpo da noticia.</p></body></html>"
      );
      return;
    }

    // /info/json -> mesma URL com tipo nao-HTML (cartao tem de orientar).
    if (path === "/info/json") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end('{"titulo":"isto nao e uma pagina"}');
      return;
    }

    // /multi/a e /multi/b -> duas paginas sobre o mesmo assunto, com secoes
    // de outro tema para a busca multi nao misturar.
    if (path === "/multi/a") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>Lobos A</title></head><body>" +
          "<h1>Guia dos Lobos</h1>" +
          "<h2>Habitat do lobo</h2>" +
          "<p>O lobo vive em matas frias e caça em matilha durante a noite.</p>" +
          "<h2>Pesca</h2><p>A pesca do salmao acontece no rio.</p>" +
          "</body></html>"
      );
      return;
    }
    if (path === "/multi/b") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>Lobos B</title></head><body>" +
          "<h1>Biologia dos Lobos</h1>" +
          "<h2>Alimentacao do lobo</h2>" +
          "<p>O lobo e carnivoro e come veados, coelhos e outros animais.</p>" +
          "<h2>Jardim</h2><p>Como plantar tomates no quintal.</p>" +
          "</body></html>"
      );
      return;
    }

    // /tabela-cabecalho-curto -> cabecalho com 1 <th> e dados com 2 colunas.
    // A largura da tabela vem das linhas de dados; a linha de cabecalho mais
    // curta nao pode derrubar a leitura.
    if (path === "/tabela-cabecalho-curto") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>Cabecalho curto</title></head><body>" +
          "<table><tr><th>Nome</th></tr><tr><td>Ana</td><td>10</td></tr></table>" +
          "</body></html>"
      );
      return;
    }

    // /tabelas -> uma tabela com cabecalho <th> e uma sem cabecalho.
    if (path === "/tabelas") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>Tabelas</title></head><body>" +
          "<h1>Precos</h1>" +
          "<table><thead><tr><th>Produto</th><th>Preco</th></tr></thead>" +
          "<tbody><tr><td>Caneta</td><td>2</td></tr><tr><td>Caderno</td><td>15</td></tr></tbody></table>" +
          "<table><tr><td>sem</td><td>cabecalho</td></tr><tr><td>x</td><td>y</td></tr></table>" +
          "</body></html>"
      );
      return;
    }

    // /tabela-grande -> tres tabelas longas. Serve para provar que o corte por
    // maxChars sai com JSON valido e sem reserializar o documento a cada linha.
    if (path === "/tabela-grande") {
      const linhas = [];
      for (let i = 1; i <= 30; i++) {
        linhas.push(
          `<tr><td>item ${i}</td><td>${"descricao longa ".repeat(4)}</td><td>${i * 10}</td></tr>`
        );
      }
      const tabela =
        "<table><tr><th>Item</th><th>Descricao</th><th>Valor</th></tr>" + linhas.join("") + "</table>";
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>Tabela grande</title></head><body>" +
          tabela +
          tabela +
          tabela +
          "</body></html>"
      );
      return;
    }

    // /faq -> FAQPage no JSON-LD E a mesma secao visivel (uma pergunta repetida
    // de proposito, para provar a deduplicacao).
    if (path === "/faq") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>Duvidas</title>" +
          '<script type="application/ld+json">' +
          '{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[' +
          '{"@type":"Question","name":"O envio e gratuito?",' +
          '"acceptedAnswer":{"@type":"Answer","text":"Sim, o envio e gratuito para todo o Brasil."}},' +
          '{"@type":"Question","name":"Posso trocar o produto?",' +
          '"acceptedAnswer":{"@type":"Answer","text":"Sim, em ate 30 dias."}}]}' +
          "</script></head><body><h1>Duvidas</h1>" +
          "<h2>Perguntas frequentes</h2>" +
          "<h3>O envio e gratuito?</h3><p>Sim, o envio e gratuito para todo o Brasil.</p>" +
          "<h3>Qual o prazo de entrega?</h3><p>O prazo e de 5 dias uteis.</p>" +
          // Rodapé que termina em "?" com link (o caso docs.python.org):
          // não pode virar pergunta. A linha seguinte existe para dar um
          // "resposta" ao falso positivo, como no site real.
          '<p>Last updated on 2026-10-31. <a href="https://exemplo.org/bugs">Found a bug</a>?</p>' +
          "<p>Created using Sphinx.</p>" +
          "<h2>Contato</h2><p>Fale com a gente.</p>" +
          "</body></html>"
      );
      return;
    }

    // ---- fixtures do read_document ----
    if (path === "/doc/exemplo.docx") {
      res.writeHead(200, {
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      res.end(construirDocxFixture());
      return;
    }
    if (path === "/doc/exemplo.pptx") {
      res.writeHead(200, {
        "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });
      res.end(construirPptxFixture());
      return;
    }
    if (path === "/doc/exemplo.epub") {
      res.writeHead(200, { "content-type": "application/epub+zip" });
      res.end(construirEpubFixture());
      return;
    }
    if (path === "/doc/falso.docx") {
      res.writeHead(200, {
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      res.end("isto nao e um arquivo zip");
      return;
    }

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
    hitsDe: (id) => hits.get(id) || 0,
    fluxoDe: (nome) => fluxo.get(nome) || null,
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
