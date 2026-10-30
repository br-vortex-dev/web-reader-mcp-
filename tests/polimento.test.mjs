// Regressões da rodada de polimento 1.9.6: o catálogo MCP com title e
// annotations, o IPv4 traduzido em IPv6, credenciais fora da mensagem de erro,
// a guarda de regex do find_on_page (e a contagem de ocorrências), a marca
// truncada do diff_page, o <link> alternate do Atom, o título com ">" e o PDF
// protegido por senha.
//
// Uso: node --test tests/polimento.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { startFixture, startMcp, SERVER_PATH } from "./helpers.mjs";
import { TOOLS } from "../src/tool-schemas.mjs";
import { tamanhoDaMarca, diffDeLinhas, formatarSaidaDiff } from "../src/snapshot.mjs";
import { analisarFeed } from "../src/feeds.mjs";
import { extractMeta } from "../src/html-parser.mjs";
import { extrairTextoPdf } from "../src/pdf.mjs";

let fixture;
let mcpLocal;
let mcpBloqueando;

before(async () => {
  fixture = await startFixture();
  mcpLocal = await startMcp({ ALLOW_PRIVATE_HOSTS: "1" });
  mcpBloqueando = await startMcp();
});

after(async () => {
  mcpLocal?.close();
  mcpBloqueando?.close();
  await fixture?.close();
});

/* ------------------------- catálogo MCP -------------------------------- */

test("catálogo: as 12 ferramentas têm title e annotations de leitura", () => {
  assert.equal(TOOLS.length, 12);
  for (const tool of TOOLS) {
    assert.equal(typeof tool.title, "string", `${tool.name} sem title`);
    assert.ok(tool.title.length > 0, `${tool.name} com title vazio`);
    assert.deepEqual(
      tool.annotations,
      {
        readOnlyHint: true,
        destructiveHint: false,
        // diff_page grava a marca a cada chamada: repetir muda o ponto de
        // comparação da próxima, então não é idempotente.
        idempotentHint: tool.name !== "diff_page",
        openWorldHint: true,
      },
      `${tool.name}: annotations inesperadas`
    );
  }
});

/* --------------------- SSRF: IPv4 traduzido em IPv6 -------------------- */

test("IPv4 traduzido (::ffff:0:a.b.c.d) é bloqueado e o IP não aparece", { timeout: 30000 }, async () => {
  // O URL normaliza ::ffff:0:127.0.0.1 para ::ffff:0:7f00:1; o IPv4 embutido
  // é que tem de ser validado (e bloqueado), e a mensagem não pode ecoá-lo.
  const r = await mcpBloqueando.call("read_page", {
    url: "http://[::ffff:0:127.0.0.1]/",
    timeoutMs: 3000,
  });
  assert.equal(r.isError, true, `deveria bloquear: ${r.text}`);
  assert.match(r.text, /Host bloqueado/);
  assert.doesNotMatch(r.text, /127\.0\.0\.1/, `o IP resolvido não pode aparecer: ${r.text}`);
});

/* ------------------------- credenciais na URL --------------------------- */

test("credenciais na URL são recusadas sem ecoar a senha", { timeout: 30000 }, async () => {
  const r = await mcpBloqueando.call("read_page", {
    url: "http://usuario:segredo123@127.0.0.1/",
    timeoutMs: 3000,
  });
  assert.equal(r.isError, true, `deveria recusar: ${r.text}`);
  assert.match(r.text, /credenciais/i);
  assert.ok(!r.text.includes("segredo123"), `a senha vazou na resposta: ${r.text}`);
  assert.ok(!r.text.includes("usuario:segredo123"), `a credencial vazou na resposta: ${r.text}`);
});

/* -------------------------- find_on_page -------------------------------- */

test("find_on_page recusa regex com quantificador aninhado", { timeout: 30000 }, async () => {
  const r = await mcpLocal.call("find_on_page", {
    url: `${fixture.url}/pagina`,
    query: "(a+)+$",
    regex: true,
    timeoutMs: 5000,
  });
  assert.equal(r.isError, true, `deveria recusar: ${r.text}`);
  assert.match(r.text, /quantificador/);
});

test("find_on_page conta ocorrências, não linhas", { timeout: 30000 }, async () => {
  // O PAD do fixture repete "Lorem" 6 vezes numa única linha: as seis estão
  // na linha exibida, então NÃO existe ocorrência "além do limite".
  const r = await mcpLocal.call("find_on_page", {
    url: `${fixture.url}/pagina`,
    query: "Lorem",
    maxHits: 2,
    contexto: 0,
    timeoutMs: 5000,
  });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Ocorrencias: 6 em \d+ linha\(s\)/);
  assert.doesNotMatch(r.text, /alem do limite/);
});

test("find_on_page limita linhas e diz quantas ficaram de fora", { timeout: 30000 }, async () => {
  // "CASO" aparece em várias linhas diferentes; maxHits: 2 mostra duas e o
  // rodapé tem de falar em LINHAS ocultas, não em ocorrências.
  const r = await mcpLocal.call("find_on_page", {
    url: `${fixture.url}/pagina`,
    query: "CASO",
    maxHits: 2,
    contexto: 0,
    timeoutMs: 5000,
  });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /— exibindo 2 linha\(s\) com acerto/);
  assert.match(r.text, /\[\.\.\. \d+ linha\(s\) com ocorrencias alem do limite/);
});

/* ---------------------------- diff_page --------------------------------- */

test("diff grande nunca afirma SEM MUDANCA quando o miolo diferiu", () => {
  const d = diffDeLinhas("linha a", "linha b", { maxLinhas: 0 });
  assert.equal(d.grande, true);
  assert.equal(d.iguais, false);
});

test("marca truncada avisa que a mudança pode estar fora dos 64 KB", () => {
  const saida = formatarSaidaDiff({
    finalUrl: "https://exemplo.com/pagina",
    primeiraVez: false,
    gravado: true,
    diff: { grande: true, iguais: false, adicionadas: [], removidas: [] },
    hashAntes: "antes",
    hashDepois: "depois",
    maxChars: 8000,
    marcaTruncada: true,
  });
  assert.match(saida, /primeiros 64 KB/);
  assert.match(saida, /Estado: MUDOU/);
});

test("tamanhoDaMarca conta bytes, não caracteres", () => {
  assert.equal(tamanhoDaMarca({ hash: "abcd", texto: "ação" }), 4 + 6);
});

/* ------------------------------- feeds ---------------------------------- */

test("Atom: alternate vence self/enclosure quando há vários <link>", () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Feed</title>
  <entry>
    <title>Episodio</title>
    <link rel="self" href="https://exemplo.com/self"/>
    <link rel="enclosure" href="https://exemplo.com/audio.mp3"/>
    <link href="https://exemplo.com/artigo"/>
  </entry>
  <entry>
    <title>So audio</title>
    <link rel="enclosure" href="https://exemplo.com/audio2.mp3"/>
  </entry>
</feed>`;
  const feed = analisarFeed(xml);
  assert.equal(feed.formato, "atom");
  assert.equal(feed.itens[0].link, "https://exemplo.com/artigo");
  assert.equal(feed.itens[1].link, "https://exemplo.com/audio2.mp3");
});

/* ------------------------------ parser ---------------------------------- */

test("título com '>' dentro do <title> é lido inteiro", () => {
  const meta = extractMeta(
    "<html><head><title>Preço > 100 &amp; mais</title></head><body></body></html>"
  );
  assert.equal(meta.title, "Preço > 100 & mais");
});

/* -------------------------------- PDF ----------------------------------- */

test("PDF com /Encrypt é reconhecido como protegido por senha", () => {
  const pdf = Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R /Encrypt 2 0 R>>\nstartxref\n0\n%%EOF\n",
    "latin1"
  );
  const r = extrairTextoPdf(pdf);
  assert.equal(r.criptografado, true);
  assert.equal(r.temTexto, false);
});

/* ---------------------------- HTTP fail-closed -------------------------- */

test("HTTP sem MCP_AUTH_TOKEN derruba o processo na subida", { timeout: 30000 }, async () => {
  const env = { ...process.env, PORT: "0" };
  delete env.MCP_AUTH_TOKEN;
  delete env.MCP_ALLOW_ANONYMOUS;
  const child = spawn(process.execPath, [SERVER_PATH], { env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr += d.toString();
  });
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve("timeout");
    }, 10000);
    child.on("exit", (c) => {
      clearTimeout(timer);
      resolve(c);
    });
  });
  assert.equal(code, 1, `esperava exit 1, veio ${code}: ${stderr}`);
  assert.match(stderr, /MCP_AUTH_TOKEN/);
});
