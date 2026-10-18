#!/usr/bin/env node
/**
 * _probe-legenda2.mjs — isola POR QUE o download da legenda volta vazio.
 *
 * Modo padrão (robots LIGADO, como o servidor): só consulta o robots.txt para
 * várias variações do caminho da legenda e diz passa/bloqueia.
 *
 * Modo --raw (rodar com ROBOTS_RESPECT=0 no ambiente): busca de verdade e
 * isola a causa do vazio comparando três clientes — o transporte do projeto,
 * o fetch global do Node (undici) e o curl do sistema — com e sem Referer.
 */
import { spawnSync } from "node:child_process";

const id = "dQw4w9WgXcQ";
const pagina = `https://www.youtube.com/watch?v=${id}`;
const raw = process.argv.includes("--raw");

const { checarRobots } = await import("../src/security.mjs");

async function robots(rotulo, url) {
  try {
    await checarRobots(url);
    console.log(`PASSA     ${rotulo}`);
  } catch (err) {
    console.log(`BLOQUEADO ${rotulo} — ${String(err.message).split("Defina")[0].trim()}`);
  }
}

if (!raw) {
  console.log("== robots.txt (como o servidor avalia) ==");
  await robots("www /watch", pagina);
  await robots("www /api/timedtext", `https://www.youtube.com/api/timedtext?v=${id}&lang=en`);
  await robots("www /timedtext (sem _video)", `https://www.youtube.com/timedtext?v=${id}&lang=en`);
  await robots("m /api/timedtext", `https://m.youtube.com/api/timedtext?v=${id}&lang=en`);
  await robots("i.ytimg capa do video", `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
  console.log("\nfim (rodar com --raw e ROBOTS_RESPECT=0 para os testes de rede).");
  process.exit(0);
}

const { fetchTextCached } = await import("../src/fetch.mjs");

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

console.log("== página: extrair baseUrl fresco da legenda ==");
const pg = await fetchTextCached(pagina, { timeoutMs: 20000 });
const player = extrairObjetoApos(pg.text, "ytInitialPlayerResponse");
const tracks = ((player || {}).captions || {}).playerCaptionsTracklistRenderer || {};
const lista = tracks.captionTracks || [];
const en = lista.find((t) => t.languageCode === "en" && !t.kind) || lista[0];
console.log(`tracks: ${lista.length}; usando ${en ? en.languageCode + "/" + (en.kind || "manual") : "(nenhuma)"}`);
if (!en) process.exit(0);
const baseUrl = en.baseUrl;

async function viaProjeto(rotulo, url) {
  const t0 = Date.now();
  try {
    const r = await fetchTextCached(url, { timeoutMs: 15000, retries: 0 });
    const b = r.text || "";
    console.log(
      `[projeto] ${rotulo}: ${Date.now() - t0} ms, ${b.length} bytes, ct=${r.contentType || "?"}${
        b.length ? " | " + b.slice(0, 90).replace(/\n/g, " ") : ""
      }`
    );
  } catch (err) {
    console.log(`[projeto] ${rotulo}: FALHOU ${err.name}: ${err.message.split("(")[0]}`);
  }
}

await viaProjeto("baseUrl cru", baseUrl);
await viaProjeto(
  "baseUrl + fmt=json3",
  /fmt=/.test(baseUrl) ? baseUrl.replace(/fmt=[^&]*/, "fmt=json3") : `${baseUrl}&fmt=json3`
);
await viaProjeto("www /timedtext limpo", `https://www.youtube.com/timedtext?v=${id}&lang=en&fmt=json3`);
await viaProjeto("m /api/timedtext limpo", `https://m.youtube.com/api/timedtext?v=${id}&lang=en&fmt=json3`);
await viaProjeto("m /timedtext limpo", `https://m.youtube.com/timedtext?v=${id}&lang=en&fmt=json3`);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function viaFetchGlobal(rotulo, url, comReferer) {
  const headers = { "user-agent": UA, "accept-language": "pt-BR,pt;q=0.9,en;q=0.8" };
  if (comReferer) headers.referer = pagina;
  try {
    const res = await fetch(url, { headers });
    const b = await res.text();
    console.log(
      `[undici${comReferer ? "+ref" : "   "}] ${rotulo}: HTTP ${res.status}, ${b.length} bytes, ct=${
        res.headers.get("content-type") || "?"
      }${b.length ? " | " + b.slice(0, 90).replace(/\n/g, " ") : ""}`
    );
  } catch (err) {
    console.log(`[undici] ${rotulo}: FALHOU ${err.message}`);
  }
}

await viaFetchGlobal("baseUrl cru", baseUrl, false);
await viaFetchGlobal("baseUrl cru", baseUrl, true);

function viaCurl(rotulo, url, comReferer) {
  const args = [
    "-s",
    "-D",
    "-",
    "-o",
    "NUL",
    "-w",
    "HTTP %{http_code} | bytes=%{size_download}",
    "-A",
    UA,
    "-H",
    "Accept-Language: pt-BR,pt;q=0.9,en;q=0.8",
  ];
  if (comReferer) args.push("-H", `Referer: ${pagina}`);
  args.push(url);
  const r = spawnSync("curl.exe", args, { encoding: "utf8" });
  if (r.error) {
    console.log(`[curl] erro: ${r.error.message}`);
    return;
  }
  const linhas = String(r.stdout || "")
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => /^HTTP|^content-type|^content-length|bytes=/.test(l));
  console.log(`[curl${comReferer ? "+ref" : "   "}] ${rotulo}: ${linhas.join(" | ")}`);
}

viaCurl("baseUrl cru", baseUrl, false);
viaCurl("baseUrl cru", baseUrl, true);

console.log("\nfim do diagnóstico raw.");
