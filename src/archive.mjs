/**
 * archive.mjs — ler a versão arquivada de uma página (read_archived).
 *
 * O QUE É
 *   Busca a página no Internet Archive (Wayback Machine) e devolve o texto da
 *   captura, com a data em que ela foi feita. Serve para página que saiu do ar,
 *   mudou desde ontem, ou que o site bloqueia hoje mas o arquivo guardou.
 *
 * COMO
 *   O endereço é montado no formato do próprio Wayback:
 *   `https://web.archive.org/web/<data>id_/<url original>`. O `id_` pede o
 *   documento CRU (sem a barra de ferramentas do arquivo), e a data `2` é o
 *   atalho para a captura mais recente. Quem responde é o archive.org; todo o
 *   caminho de segurança, robots, cache e junção do servidor continua valendo.
 *
 * O QUE ENTRA / O QUE SAI
 *   Entra: a URL original e, opcionalmente, a data (AAAAMMDD[hhmmss]).
 *   Sai:   título, data da captura, URL do arquivo e o texto em markdown.
 *
 * QUEM USA
 *   Usado por: tools.mjs.
 *   Importa de: conversao, errors, fetch, utils.
 */

import {
  fetchTextDocumentoCached,
  validateHttpUrl,
  clampTimeoutMs,
  clampMaxChars,
  truncate,
  ensureHtml,
} from "./fetch.mjs";
import { metaMemo, markdownMemo, fullLengthDe } from "./conversao.mjs";
import { ParametroInvalidoError } from "./errors.mjs";
import { urlSemCredenciais } from "./utils.mjs";

const BASE_WAYBACK = "https://web.archive.org/web";

/** Data no formato do Wayback (4 a 14 dígitos) ou erro de parâmetro. */
function dataDoPedido(valor) {
  if (valor === undefined || valor === null || String(valor).trim() === "") return "2";
  const texto = String(valor).trim();
  if (!/^\d{4,14}$/.test(texto)) {
    throw new ParametroInvalidoError(
      "timestamp",
      "use 4 a 14 digitos no formato AAAAMMDD ou AAAAMMDDhhmmss, ou omita para a captura mais recente"
    );
  }
  return texto;
}

/** Extrai o carimbo de 14 dígitos da URL final do Wayback. */
function carimboDaUrl(url) {
  const achado = /\/(\d{8,14})(?:id_)?\//.exec(String(url || ""));
  return achado ? achado[1] : "";
}

/** Carimbo do Wayback em data legível (sempre UTC, como o arquivo grava). */
function dataLegivel(carimbo) {
  const partes = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/.exec(carimbo);
  if (!partes) return carimbo;
  const [, ano, mes, dia, hora, minuto, segundo] = partes;
  const data = `${ano}-${mes}-${dia}`;
  return hora ? `${data} ${hora}:${minuto}:${segundo} UTC` : data;
}

/**
 * O Wayback responde 200 com uma página de aviso quando não tem a captura.
 * Confundir esse aviso com conteúdo faria a IA ler "não arquivado" como se
 * fosse a página.
 */
function paginaSemCaptura(html) {
  const inicio = String(html || "").slice(0, 4000);
  return /not archived|not available in the wayback machine|não está disponível|page cannot be crawled|blocked site error/i.test(inicio);
}

function respostaSemCaptura(original, timestamp) {
  return (
    `# Arquivado: sem captura\nURL original: ${urlSemCredenciais(original)}\n` +
    `Pedido: ${timestamp === "2" ? "captura mais recente" : dataLegivel(timestamp)}\n\n` +
    `O Internet Archive nao tem uma captura desta URL para esse pedido. ` +
    `Tente outra data (timestamp AAAAMMDD) ou leia a pagina atual com read_page.\n`
  );
}

/**
 * Ferramenta read_archived.
 */
export async function toolReadArchived(args = {}) {
  const parsed = validateHttpUrl(args.url);
  const timestamp = dataDoPedido(args.timestamp);
  const maxChars = clampMaxChars(args.maxChars);
  const timeoutMs = clampTimeoutMs(args.timeoutMs);

  // O `id_` devolve o documento como o site publicou; sem ele o Wayback
  // injeta a própria barra de navegação, que viraria "conteúdo" da página.
  const pedido = `${BASE_WAYBACK}/${timestamp}id_/${parsed.href}`;

  let payload;
  try {
    payload = await fetchTextDocumentoCached(pedido, { timeoutMs });
  } catch (err) {
    const codigo = String((err && err.code) || "");
    if (codigo === "HTTP_404" || (err && err.status === 404)) {
      return respostaSemCaptura(parsed.href, timestamp);
    }
    throw err;
  }

  if (paginaSemCaptura(payload.text)) {
    return respostaSemCaptura(parsed.href, timestamp);
  }

  ensureHtml(payload.contentType, payload.text, payload.finalUrl);

  const carimbo = carimboDaUrl(payload.finalUrl) || (timestamp === "2" ? "" : timestamp);
  const meta = metaMemo(payload);
  const markdown = markdownMemo(payload);
  const { text, truncated } = truncate(markdown, maxChars);

  const linhas = [
    `# Arquivado: ${meta.title || "(sem titulo)"}`,
    `URL original: ${parsed.href}`,
    `Captura: ${carimbo ? dataLegivel(carimbo) : "data nao informada pelo arquivo"}` +
      (carimbo ? ` (timestamp ${carimbo})` : ""),
    `URL do arquivo: ${payload.finalUrl}`,
  ];
  if (meta.description) linhas.push(`Descricao: ${meta.description}`);
  if (meta.author) linhas.push(`Autor: ${meta.author}`);
  linhas.push(
    `Conteudo: ${fullLengthDe(payload, markdown)} caracteres` +
      (truncated ? ` (exibidos ${text.length})` : "")
  );
  linhas.push("");
  linhas.push(text);
  return linhas.join("\n");
}
