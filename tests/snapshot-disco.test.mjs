// Testes da persistência das marcas do diff_page (SNAPSHOT_DIR).
//
// O que se quer garantir:
// - a marca sobrevive a um reinício do serviço (o restart do keep-alive deixa de
//   apagar o ponto de comparação);
// - um worker que nunca gravou aquela URL vê a marca do outro (WEB_CONCURRENCY);
// - sem SNAPSHOT_DIR tudo fica como antes (só em memória);
// - disco avariado não derruba a ferramenta: ela degrada para memória;
// - o nome do ficheiro é o hash da chave (a URL nunca vira caminho) e um
//   ficheiro forjado, corrompido ou vencido não furia marca para outra URL.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFixture, startMcp } from "./helpers.mjs";

// O SNAPSHOT_DIR deste processo tem que estar certo ANTES do import dinâmico do
// módulo (config lê o ambiente uma vez, no arranque). Os testes e2e passam o
// diretório deles explicitamente, então este valor nunca escorre para lá.
const DIR_UNIDADE = mkdtempSync(join(tmpdir(), "wrm-marca-unidade-"));
process.env.SNAPSHOT_DIR = DIR_UNIDADE;

const dirs = [];
function dirNovo() {
  const dir = mkdtempSync(join(tmpdir(), "wrm-marca-"));
  dirs.push(dir);
  return dir;
}

const nomeDaChave = (chave) => createHash("sha256").update(String(chave), "utf8").digest("hex").slice(0, 32);
const arquivoDaChave = (dir, chave) => join(dir, `${nomeDaChave(chave)}.json`);

let fixture;
let m; // src/snapshot.mjs importado com DIR_UNIDADE no ambiente

before(async () => {
  fixture = await startFixture();
  m = await import("../src/snapshot.mjs");
});

after(async () => {
  delete process.env.SNAPSHOT_DIR;
  await fixture?.close();
  for (const dir of [DIR_UNIDADE, ...dirs]) rmSync(dir, { recursive: true, force: true });
});

/** A escrita da marca é em fogo e desaparecido: espera pousar no disco. */
async function esperarMarcaNoDisco(dir, ms = 4000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (readdirSync(dir).some((n) => n.endsWith(".json"))) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * De ponta a ponta: instâncias reais do servidor                       *
 * ------------------------------------------------------------------ */

test("a marca sobrevive ao reinício do serviço — a releitura compara, não recomeça", { timeout: 60000 }, async () => {
  const dir = dirNovo();
  const url = `${fixture.url}/diff/estavel`;

  const a = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", SNAPSHOT_DIR: dir });
  const r1 = await a.call("diff_page", { url });
  assert.equal(r1.isError, false, r1.text);
  assert.match(r1.text, /PRIMEIRA leitura/);
  assert.ok(await esperarMarcaNoDisco(dir), "a marca tem de pousar antes do fecho do processo");
  await a.close();

  // Instância nova: memória fria, disco quente — é o que acontece em cada restart.
  const b = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", SNAPSHOT_DIR: dir });
  try {
    const r2 = await b.call("diff_page", { url });
    assert.equal(r2.isError, false, r2.text);
    assert.doesNotMatch(r2.text, /PRIMEIRA leitura/, `a marca em disco deveria ter sobrevivido:\n${r2.text}`);
    assert.match(r2.text, /SEM MUDANCA/);
    assert.match(b.stderr(), /marcas do diff_page em .*: 1 recuperadas/, "o arranque devia dizer o que recuperou");
  } finally {
    await b.close();
  }
});

test("um worker que não gravou vê a marca do outro (WEB_CONCURRENCY)", { timeout: 60000 }, async () => {
  const dir = dirNovo();
  const url = `${fixture.url}/diff/estavel`;

  const a = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", SNAPSHOT_DIR: dir });
  const b = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", SNAPSHOT_DIR: dir });
  try {
    const ra = await a.call("diff_page", { url });
    assert.match(ra.text, /PRIMEIRA leitura/);
    // É a única sincronia entre os dois processos: a escrita voa, a leitura tem
    // que apanhar a marca já pousada.
    assert.ok(await esperarMarcaNoDisco(dir), "a marca tinha que estar no disco");

    const rb = await b.call("diff_page", { url });
    assert.equal(rb.isError, false, rb.text);
    assert.doesNotMatch(rb.text, /PRIMEIRA leitura/, "o segundo worker tinha que achar a marca no disco");
    assert.match(rb.text, /SEM MUDANCA/);

    const health = await (await fetch(`${b.base}/health`)).text();
    const mt = health.match(/marcas: \d+ \(disco, escritas \d+, lidas do disco (\d+)/);
    assert.ok(mt, `o /health devia trazer o contador de marcas: ${health}`);
    assert.equal(Number(mt[1]), 1, `a marca veio do disco, não da memória: ${health}`);
  } finally {
    await a.close();
    await b.close();
  }
});

test("mudança de conteúdo é vista mesmo quando a marca veio do disco", { timeout: 60000 }, async () => {
  const dir = dirNovo();
  const url = `${fixture.url}/diff/muda`;

  const a = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", SNAPSHOT_DIR: dir });
  assert.match((await a.call("diff_page", { url })).text, /PRIMEIRA leitura/);
  await a.close();

  const b = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", SNAPSHOT_DIR: dir });
  try {
    const r2 = await b.call("diff_page", { url });
    assert.equal(r2.isError, false, r2.text);
    // /diff/muda sobe o contador a cada pedido: a marca do disco é a versão
    // anterior, então aqui há exatamente uma linha trocada.
    assert.match(r2.text, /Estado: MUDOU/);
    assert.match(r2.text, /Linhas: \+1 \/ -1/);
    assert.doesNotMatch(r2.text, /Paragrafo que nunca muda/);
  } finally {
    await b.close();
  }
});

test("sem SNAPSHOT_DIR a marca fica só em memória (comportamento de antes)", { timeout: 60000 }, async () => {
  const url = `${fixture.url}/diff/estavel`;

  const a = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", SNAPSHOT_DIR: "" });
  assert.match((await a.call("diff_page", { url })).text, /PRIMEIRA leitura/);
  const healthA = await (await fetch(`${a.base}/health`)).text();
  assert.match(healthA, /marcas: \d+ \(memoria/, `sem diretório o /health diz "memoria": ${healthA}`);
  assert.match(a.stderr(), /sem SNAPSHOT_DIR/);
  await a.close();

  const b = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", SNAPSHOT_DIR: "" });
  try {
    assert.match((await b.call("diff_page", { url })).text, /PRIMEIRA leitura/, "sem disco a releitura recomeça");
  } finally {
    await b.close();
  }
});

test("disco onde não se pode escrever não derruba o diff_page (degrada para memória)", { timeout: 60000 }, async () => {
  const dir = dirNovo();
  // SNAPSHOT_DIR aponta para um ficheiro: o mkdir falha (ENOTDIR) em qualquer SO.
  const bloqueio = join(dir, "bloqueio");
  writeFileSync(bloqueio, "isto não é um diretório", "utf8");

  const a = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", SNAPSHOT_DIR: bloqueio });
  try {
    const r = await a.call("diff_page", { url: `${fixture.url}/diff/estavel` });
    assert.equal(r.isError, false, `a falha de disco não pode virar erro da ferramenta: ${r.text}`);
    assert.match(r.text, /PRIMEIRA leitura/);

    const health = await (await fetch(`${a.base}/health`)).text();
    const mt = health.match(/marcas: \d+ \(disco, escritas \d+, lidas do disco \d+, falhas (\d+)/);
    assert.ok(mt, `o /health devia contar a falha de escrita: ${health}`);
    assert.ok(Number(mt[1]) >= 1);
    assert.match(a.stderr(), /falha ao gravar marca/);

    // A memória continua a servir: a segunda leitura compara com a primeira.
    await new Promise((r2) => setTimeout(r2, 700)); // deixa o cache da página vencer
    const r1 = await a.call("diff_page", { url: `${fixture.url}/diff/estavel` });
    assert.match(r1.text, /SEM MUDANCA/);
  } finally {
    await a.close();
  }
});

/* ------------------------------------------------------------------ *
 * Unidade: o que é escrito no disco                                   *
 * ------------------------------------------------------------------ */

test("a marca é gravada como hash da chave, com a chave dentro, sem sobra de .tmp", { timeout: 60000 }, async () => {
  const chave = m.chaveSnapshot("https://exemplo.com/a?utm_source=campanha#fim");
  const gravado = await m.guardarMarca(chave, { hash: "abc123", texto: "linha um" }, 9);

  assert.equal(gravado, true);
  assert.deepEqual(readdirSync(DIR_UNIDADE), [`${nomeDaChave(chave)}.json`], "um ficheiro por marca, nome pelo hash");
  const corpo = JSON.parse(readFileSync(arquivoDaChave(DIR_UNIDADE, chave), "utf8"));
  assert.equal(corpo.chave, chave);
  assert.equal(corpo.hash, "abc123");
  assert.equal(corpo.texto, "linha um");
  assert.ok(Number(corpo.at) <= Date.now());
});

test("leitura que não está na memória atravessa para o disco", { timeout: 60000 }, async () => {
  const chave = m.chaveSnapshot("https://exemplo.com/a?utm_source=campanha#fim");
  const antes = m.gravacoes.lidasDoDisco;
  m.snapshots.delete(chave); // simula o outro processo: esta memória não sabe de nada

  const vista = m.buscarMarca(chave);
  assert.ok(vista, "a marca gravada no teste anterior tinha que aparecer");
  assert.equal(vista.hash, "abc123");
  assert.equal(m.gravacoes.lidasDoDisco, antes + 1, "o contador do /health tem de ver este passe");

  // E a segunda vez já vem da memória (a entrada foi promovida).
  m.buscarMarca(chave);
  assert.equal(m.gravacoes.lidasDoDisco, antes + 1);
});

test("o arranque recupera as marcas do disco", { timeout: 60000 }, async () => {
  const c1 = "https://exemplo.com/recupera-1";
  const c2 = "https://exemplo.com/recupera-2";
  await m.guardarMarca(c1, { hash: "h1", texto: "t1" }, 2);
  await m.guardarMarca(c2, { hash: "h2", texto: "t2" }, 2);
  m.snapshots.delete(c1);
  m.snapshots.delete(c2);

  const carregadas = m.carregarSnapshotsDoDisco();
  assert.ok(carregadas >= 2, `tinha que recuperar as marcas do disco: ${carregadas}`);

  const lidasAntes = m.gravacoes.lidasDoDisco;
  assert.equal(m.buscarMarca(c1).hash, "h1");
  assert.equal(m.gravacoes.lidasDoDisco, lidasAntes, "recuperada no arranque é achado na memória, não no disco");
});

test("marca vencida no disco é descartada em vez de comparada", { timeout: 60000 }, async () => {
  const chave = "https://exemplo.com/vencida";
  const caminho = arquivoDaChave(DIR_UNIDADE, chave);
  writeFileSync(caminho, JSON.stringify({ chave, hash: "velha", texto: "t", at: Date.now() - 7 * 60 * 60 * 1000 }), "utf8");
  const descartadasAntes = m.gravacoes.descartadas;

  assert.equal(m.buscarMarca(chave), null, "mais velha que o TTL não é marca");
  assert.equal(existsSync(caminho), false, "a marca vencida sai do disco");
  assert.equal(m.gravacoes.descartadas, descartadasAntes + 1);
});

test("ficheiro corrompido ou forjado não vira marca", { timeout: 60000 }, async () => {
  const corrompida = "https://exemplo.com/corrompida";
  writeFileSync(arquivoDaChave(DIR_UNIDADE, corrompida), "{ isto nao e json", "utf8");
  assert.equal(m.buscarMarca(corrompida), null, "JSON inválido é tratado como ausência");

  // Ficheiro que declara uma chave diferente do próprio nome: nem a leitura nem o
  // arranque o aceitam, senão uma marca furaria o diff de outra URL.
  const legitima = "https://exemplo.com/legitima";
  const impostora = "https://exemplo.com/OUTRA";
  writeFileSync(arquivoDaChave(DIR_UNIDADE, legitima), JSON.stringify({ chave: impostora, hash: "h", texto: "t", at: Date.now() }), "utf8");
  assert.equal(m.buscarMarca(legitima), null, "chave que não bate com o nome não é a marca desta URL");

  writeFileSync(arquivoDaChave(DIR_UNIDADE, legitima), JSON.stringify({ chave: impostora, hash: "h", texto: "t", at: Date.now() }), "utf8");
  m.carregarSnapshotsDoDisco();
  assert.equal(m.snapshots.map.has(impostora), false, "o arranque não cria vaga pela chave de dentro do ficheiro");
  assert.equal(m.snapshots.map.has(legitima), false, "nem pela chave do nome: o conteúdo não confere");
});

test("a chave canônica não muda com parâmetros de rastreio", { timeout: 60000 }, async () => {
  const a = m.chaveSnapshot("https://exemplo.com/pagina?utm_source=x");
  const b = m.chaveSnapshot("https://exemplo.com/pagina?fbclid=y");
  assert.equal(a, b, "as duas URLs têm que partilhar a mesma marca");
  assert.notEqual(a, m.chaveSnapshot("https://exemplo.com/pagina?page=2"));
});
