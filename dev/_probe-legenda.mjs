#!/usr/bin/env node
/**
 * _probe-legenda.mjs — diagnóstico da TRANSCRIÇÃO do YouTube.
 *
 * A página /watch devolve metadados e a lista de legendas, mas o download da
 * legenda aponta para /api/timedtext — e o robots.txt do youtube.com tem
 * "Disallow: /api/". Este probe responde, com fatos:
 *   1. O corpo da legenda vem com alguma variação de URL/parametro?
 *   2. O retorno vazio é do endpoint em si ou da forma do pedido?
 *
 * Roda com ROBOTS_RESPECT=0 (só AQUI, para enxergar o comportamento cru do
 * endpoint). Nada disso é decisão de produto — é diagnóstico.
 *
 * Uso: node dev/_probe-legenda.mjs [id]
 */
process.env.ROBOTS_RESPECT = "0";
const { fetchTextCached } = await import("../src/fetch.mjs");

const id = process.argv[2] || "dQw4w9WgXcQ";

function extrairObjetoApos(texto, marcador) {
  const pos = texto.indexOf(marcador);
  if (pos === -1) return null;
  const i = texto.indexOf("{", pos + marcador.length);
  if (i === -1) return null;
  let depth = 0;
  let emString = false;
  let escape = false;
  let j = i;
  for (; j < texto.length; j++) {
    const c = texto[j];
    if (emString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') emString = false;
      continue;
    }
    if (c === '"') emString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        j++;
        break;
      }
    }
  }
  try {
    return JSON.parse(texto.slice(i, j));
  } catch {
    return null;
  }
}

async function checar(rotulo, url) {
  const t0 = Date.now();
  try {
    const r = await fetchTextCached(url, { timeoutMs: 15000, retries: 0 });
    const corpo = r.text || "";
    console.log(`\n[${rotulo}] ${Date.now() - t0} ms | bytes=${corpo.length} | ct=${r.contentType || "?"}`);
    console.log(`  url: ${url.slice(0, 150)}`);
    console.log(`  corpo: ${corpo.slice(0, 300).replace(/\n/g, " ") || "(VAZIO)"}`);
    return corpo;
  } catch (err) {
    console.log(`\n[${rotulo}] ${Date.now() - t0} ms | FALHOU: ${err.name}: ${err.message}`);
    console.log(`  url: ${url.slice(0, 150)}`);
    return null;
  }
}

console.log(`id: ${id}`);
const r = await fetchTextCached(`https://www.youtube.com/watch?v=${id}`, { timeoutMs: 20000 });
const player = extrairObjetoApos(r.text, "ytInitialPlayerResponse");
const tracks = ((player || {}).captions || {}).playerCaptionsTracklistRenderer || {};
const lista = tracks.captionTracks || [];
console.log(`tracks: ${lista.length}`);
const en = lista.find((t) => t.languageCode === "en" && !t.kind) || lista[0];
if (!en) {
  console.log("sem track para testar; fim.");
  process.exit(0);
}
console.log(`usando track lang=${en.languageCode} kind=${en.kind || "manual"}`);
const base = en.baseUrl;

// 1. URL crua do player (a que o player usa)
await checar("1. baseUrl cru do playerResponse", base);

// 2. baseUrl com fmt=json3
const comJson3 = /fmt=/.test(base) ? base.replace(/fmt=[^&]*/, "fmt=json3") : `${base}&fmt=json3`;
await checar("2. baseUrl + fmt=json3", comJson3);

// 3. URL limpa (só v + lang)
await checar("3. limpa sem fmt", `https://www.youtube.com/api/timedtext?v=${id}&lang=${en.languageCode}`);

// 4. limpa + json3
await checar("4. limpa + fmt=json3", `https://www.youtube.com/api/timedtext?v=${id}&lang=${en.languageCode}&fmt=json3`);

// 5. limpa + srv3
await checar("5. limpa + fmt=srv3", `https://www.youtube.com/api/timedtext?v=${id}&lang=${en.languageCode}&fmt=srv3`);

// 6. limpa + vtt
await checar("6. limpa + fmt=vtt", `https://www.youtube.com/api/timedtext?v=${id}&lang=${en.languageCode}&fmt=vtt`);

// 7. domínio legado video.google.com
await checar("7. video.google.com legado", `https://video.google.com/timedtext?lang=${en.languageCode}&v=${id}`);

// 8. baseUrl sem os parametros experimentais (exp/xpe/xoaf/xowf/ip/hl), mantendo os de assinatura
try {
  const u = new URL(base);
  for (const p of ["exp", "xpe", "xoaf", "xowf", "ip", "hl", "opi", "caps", "ei"]) u.searchParams.delete(p);
  await checar("8. baseUrl sem params experimentais", u.href);
} catch (err) {
  console.log(`\n[8] não deu para montar: ${err.message}`);
}

console.log("\nfim do diagnóstico.");
