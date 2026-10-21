// Documento maior que o teto duro (5 MB): as ferramentas que precisam do
// documento INTEIRO não podem falhar a chamada por causa do tamanho.
//
// O defeito que este teste trava (medido em dev/load/bateria-limite.json):
// em nodejs.org/api/all.html (~8 MB) o read_page respondia normalmente e o
// extract_links devolvia "Resposta muito grande (acima de 5242880 bytes)" —
// na MESMA URL. Devolver os links de um documento parcial, com aviso, é o
// comportamento certo; devolver zero links não é.
//
// Regras que valem aqui:
//   - extract_links e find_on_page devolvem o parcial COM aviso;
//   - diff_page RECUSA (um trecho comparado com a marca anterior produziria
//     um diff falso, e o cliente leria uma mudança que não houve);
//   - o payload cortado NÃO entra no cache (documento incompleto envenenaria
//     toda leitura futura da mesma URL).

import test from "node:test";
import assert from "node:assert/strict";
import { startFixture, startMcp } from "./helpers.mjs";

// O fixture serve /page/<id>?kb=N: uma página de ~N KB. 6000 KB passa do teto
// duro de 5 MB. O contador REQ-<id>-<n> (que muda a cada download real) fica
// no COMEÇO do corpo, então sobrevive ao corte — é o que prova se houve
// download novo ou resposta do cache.
const GIGANTE = "/page/gigante?kb=6000";

test("extract_links: documento acima do teto duro devolve o parcial com aviso, não erro", async () => {
  const fixture = await startFixture();
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", MAX_RESPONSE_BYTES_DOCUMENTO: "5242880" });
  try {
    const r = await mcp.call("extract_links", { url: `${fixture.url}${GIGANTE}`, limit: 20 });
    assert.equal(r.isError, false, "a ferramenta respondeu em vez de falhar");
    assert.match(r.text, /Links em/, "devolveu a lista de links");
    assert.match(r.text, /AVISO: documento maior que o teto/, "e avisou que a leitura foi parcial");
  } finally {
    mcp.close();
    await fixture.close();
  }
});

test("find_on_page: documento acima do teto duro busca no parcial e avisa", async () => {
  const fixture = await startFixture();
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", MAX_RESPONSE_BYTES_DOCUMENTO: "5242880" });
  try {
    const r = await mcp.call("find_on_page", {
      url: `${fixture.url}${GIGANTE}`,
      query: "Pagina",
      maxHits: 5,
    });
    assert.equal(r.isError, false, "a ferramenta respondeu em vez de falhar");
    assert.match(r.text, /Ocorrencias:/, "devolveu o resultado da busca");
    assert.match(r.text, /AVISO: documento maior que o teto/, "e avisou que a busca foi parcial");
  } finally {
    mcp.close();
    await fixture.close();
  }
});

test("diff_page: documento acima do teto duro RECUSA, em vez de produzir diff falso", async () => {
  const fixture = await startFixture();
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", MAX_RESPONSE_BYTES_DOCUMENTO: "5242880" });
  try {
    const r = await mcp.call("diff_page", { url: `${fixture.url}${GIGANTE}` });
    assert.equal(r.isError, true, "recusou em vez de comparar um trecho");
    assert.match(r.text, /grande/i, "e disse que o motivo é o tamanho");
  } finally {
    mcp.close();
    await fixture.close();
  }
});

test("o parcial NÃO entra no cache: a leitura seguinte baixa de novo", async () => {
  const fixture = await startFixture();
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", MAX_RESPONSE_BYTES_DOCUMENTO: "5242880" });
  try {
    const url = `${fixture.url}${GIGANTE}`;
    const a = await mcp.call("find_on_page", { url, query: "REQ-", maxHits: 1 });
    const b = await mcp.call("find_on_page", { url, query: "REQ-", maxHits: 1 });
    const reqDe = (texto) => (texto.match(/REQ-gigante-(\d+)/) || [])[1];
    assert.ok(reqDe(a.text), "a primeira leitura trouxe o contador do fixture");
    assert.ok(reqDe(b.text), "a segunda leitura também trouxe");
    assert.notEqual(reqDe(a.text), reqDe(b.text), "documento cortado não pode ficar no cache");
  } finally {
    mcp.close();
    await fixture.close();
  }
});
