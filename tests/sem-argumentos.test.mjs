// Contrato de entrada das ferramentas: chamada SEM argumento nenhum.
//
// Por que existe: `tool*(args)` sem valor padrão explodia com
// "TypeError: Cannot read properties of undefined (reading 'url')" — uma
// mensagem que não diz nada a quem chamou. O servidor já normaliza
// `params.arguments || {}`, mas a ferramenta é exportada e pode ser chamada
// direto (testes, script, uso embutido). O contrato aqui é: sem argumento,
// a resposta é um erro de PARÂMETRO com mensagem útil — nunca um TypeError.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  toolReadPage,
  toolFindOnPage,
  toolDiffPage,
  toolExtractLinks,
  toolReadMultiplePages,
  toolReadDynamicPage,
  toolDiscoverUrls,
  toolCrawlSite,
} from "../src/tools.mjs";
import { toolReadFeed, toolReadJson } from "../src/feeds.mjs";
import { toolReadPdf } from "../src/pdf.mjs";
import { toolReadVideo } from "../src/video.mjs";

const FERRAMENTAS = [
  ["read_page", toolReadPage],
  ["find_on_page", toolFindOnPage],
  ["diff_page", toolDiffPage],
  ["extract_links", toolExtractLinks],
  ["read_multiple_pages", toolReadMultiplePages],
  ["read_dynamic_page", toolReadDynamicPage],
  ["discover_urls", toolDiscoverUrls],
  ["crawl_site", toolCrawlSite],
  ["read_feed", toolReadFeed],
  ["read_json", toolReadJson],
  ["read_pdf", toolReadPdf],
  ["read_video", toolReadVideo],
];

for (const [nome, ferramenta] of FERRAMENTAS) {
  test(`${nome}: chamada sem argumento devolve erro de parametro, nao TypeError`, async () => {
    assert.equal(typeof ferramenta, "function", `${nome} precisa estar exportada`);

    const erro = await Promise.resolve()
      .then(() => ferramenta())
      .then(
        () => null,
        (err) => err
      );

    assert.ok(erro, `${nome} sem argumento deveria recusar, mas respondeu normalmente`);
    assert.ok(
      !(erro instanceof TypeError),
      `${nome} vazou TypeError cru: ${erro && erro.message}`
    );
    assert.match(
      String(erro.message || ""),
      /url|URL|endereco|endereço|parametro|parâmetro/i,
      `${nome} deveria explicar o parametro que falta, disse: ${erro && erro.message}`
    );
  });
}
