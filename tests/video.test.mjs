// Testes do read_video (metadados + transcricao) com fixtures locais.
//
// O que se quer garantir:
// - pagina com <track> acessivel -> metadados + transcricao com timestamps;
// - legenda bloqueada pelo robots -> metadados + motivo EXPLICITO (nunca
//   fingir que leu, nunca erro opaco);
// - legenda direta (.vtt) -> transcricao;
// - pagina sem video -> resposta que aponta o caminho certo (read_page).
//
// Uso: node --test tests/video.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFixture, startMcp } from "./helpers.mjs";

let fixture;
let mcp;

before(async () => {
  fixture = await startFixture();
  mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1" });
});

after(async () => {
  mcp?.close();
  await fixture?.close();
});

test("pagina com <track>: metadados + transcricao com timestamps", { timeout: 60000 }, async () => {
  const r = await mcp.call("read_video", { url: `${fixture.url}/video/com-track`, maxChars: 8000 });
  assert.equal(r.isError, false, r.text);

  assert.match(r.text, /Documentario de teste/, "titulo (og:title) deve aparecer");
  assert.match(r.text, /Um video de fixture/, "descricao deve aparecer");
  assert.match(r.text, /Legendas na plataforma: pt/, "a faixa de legenda deve ser listada");
  assert.match(r.text, /Transcricao: 3 blocos/, "a transcricao deve ter 3 blocos");
  assert.match(r.text, /\[0:01\] Bem-vindo ao video de teste\./, "primeira fala com timestamp");
  assert.match(r.text, /\[0:03\] Esta e a segunda fala da legenda\./, "segunda fala com timestamp");
  assert.match(r.text, /\[0:06\] Terceira e ultima fala do fixture\./, "terceira fala com timestamp");
  assert.match(r.text, /legenda publicada pela plataforma/, "aviso de origem da transcricao");
});

test("legenda bloqueada pelo robots: metadados + motivo explicito", { timeout: 60000 }, async () => {
  const r = await mcp.call("read_video", { url: `${fixture.url}/video/legenda-bloqueada`, maxChars: 8000 });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Video com legenda bloqueada/, "os metadados devem vir mesmo sem transcricao");
  assert.match(r.text, /Transcricao: indisponivel/, "a ausencia deve ser declarada");
  assert.match(r.text, /robots\.txt/, "o motivo deve citar o robots.txt");
});

test("legenda direta (.vtt): baixa e converte", { timeout: 60000 }, async () => {
  const r = await mcp.call("read_video", { url: `${fixture.url}/video/legenda.vtt`, maxChars: 8000 });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Legenda: legenda\.vtt/, "o titulo deve citar o arquivo");
  assert.match(r.text, /Transcricao: 3 blocos/, "a transcricao deve ter os 3 blocos");
  assert.match(r.text, /\[0:01\]/, "timestamps devem aparecer");
});

test("pagina sem video: resposta clara, sem inventar leitura", { timeout: 60000 }, async () => {
  const r = await mcp.call("read_video", { url: `${fixture.url}/video/sem-video`, maxChars: 8000 });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /sem v[ií]deo identificado/i, "deve dizer que nao ha video");
  assert.match(r.text, /read_page/, "deve apontar a ferramenta certa");
});

test("legenda pedida em idioma especifico nao quebra a escolha", { timeout: 60000 }, async () => {
  const r = await mcp.call("read_video", { url: `${fixture.url}/video/com-track`, lang: "en", maxChars: 8000 });
  assert.equal(r.isError, false, r.text);
  // So ha faixa "pt" no fixture: sem correspondencia em "en", a unica faixa vale.
  assert.match(r.text, /\[0:01\]/, "a transcricao deve vir mesmo pedindo outro idioma");
});

test("maxChars corta a saida com o aviso de truncamento", { timeout: 60000 }, async () => {
  const r = await mcp.call("read_video", { url: `${fixture.url}/video/com-track`, maxChars: 200 });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /conteudo truncado em 200 caracteres/, "o corte deve ser avisado");
});
