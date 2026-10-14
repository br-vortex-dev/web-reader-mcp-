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
export async function startFixture() {
  // Contador de requisicoes por id: deixa visivel de FORA se a resposta veio do
  // cache (mesmo contador) ou foi baixada de novo (contador maior).
  const hits = new Map();
  // Candidatos "/api/..." que o servidor realmente buscou (ordem de chegada).
  const probes = [];

  const server = http.createServer((req, res) => {
    const path = String(req.url || "/");

    // /page/<id>?kb=N -> pagina de ~N KB com o contador de requisicoes no texto.
    if (path.startsWith("/page/")) {
      const url = new URL(path, "http://local");
      const id = url.pathname.slice("/page/".length);
      const kb = Number(url.searchParams.get("kb")) || 1;
      const n = (hits.get(id) || 0) + 1;
      hits.set(id, n);
      const recheio = "x".repeat(Math.max(0, kb * 1024 - 400));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<!DOCTYPE html><html><head><title>Pagina ${id}</title></head><body>` +
          `<h1>Pagina ${id}</h1><p>REQ-${id}-${n}</p><p>${recheio}</p></body></html>`
      );
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

    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(FIXTURE_HTML);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    probes,
    clearProbes: () => {
      probes.length = 0;
    },
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
