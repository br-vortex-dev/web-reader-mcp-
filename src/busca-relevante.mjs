/**
 * busca-relevante.mjs — a busca por assunto, numa página ou em várias.
 *
 * O QUE É
 *   find_relevant responde "onde esta pagina fala disso?"; find_relevant_multi
 *   faz a mesma pergunta em até 8 páginas de uma vez e devolve os melhores
 *   trechos de cada uma. A conta é a mesma — por isso mora num módulo só: a
 *   consulta vira um conjunto de palavras (sem acento, sem plural, sem
 *   palavras vazias) e os blocos de texto são pontuados pela cobertura e pela
 *   repetição dos termos.
 *
 * POR QUE UM MÓDULO
 *   tools.mjs já passava de 1.600 linhas; a busca por trechos tem regras
 *   próprias (parada antecipada, cobertura, aviso de achado fraco) e duas
 *   ferramentas que precisam das MESMAS regras. Aqui as duas compartilham a
 *   pontuação e a memoização.
 *
 * O QUE ENTRA / O QUE SAI
 *   Entra: URL(s) + consulta + limites.
 *   Sai:  trechos em markdown, com URL e seção de origem.
 *
 * QUEM USA
 *   Usado por: tools.mjs (despacho e reexportação para os testes).
 *   Importa de: conversao, errors, fetch, relevancia, utils.
 */

import { fetchTextDocumentoCached, validateHttpUrl, clampTimeoutMs, ensureHtml, isConteudoBruto } from "./fetch.mjs";
import { termosDaConsulta, blocosDoMarkdown, pontuarBlocos, recortarTrecho } from "./relevancia.mjs";
import { markdownMemo, markdownCompleto, markdownInterrompida } from "./conversao.mjs";
import { ParametroInvalidoError, LimiteExcedidoError } from "./errors.mjs";
import { chaveCanonica, urlSemCredenciais, inteiroOuPadrao } from "./utils.mjs";

// Teto de páginas da busca múltipla. Oito é o ponto em que a chamada ainda
// responde rápido mesmo com todas frias; acima disso a IA deve dividir em
// rodadas (as páginas ficam em cache, então a segunda rodada é barata).
const MAX_FONTES_MULTI = 8;
const MAX_TRECHOS_MULTI = 20;

/**
 * Resultado da pontuação por página + consulta.
 *
 * O mesmo assunto perguntado de novo sobre a mesma página (o caso comum de um
 * site com vários usuários no mesmo tema) não reponta os blocos. A chave é o
 * PAYLOAD: quando o cache revalida e troca o objeto da página, o WeakMap solta
 * tudo sozinho. O teto por página evita crescimento numa sessão que varre
 * dezenas de assuntos.
 */
const memoDeResultado = new WeakMap();
const MEMO_POR_PAGINA = 8;

function lerMemo(payload, consulta) {
  return memoDeResultado.get(payload)?.get(consulta);
}

function guardarMemo(payload, consulta, resultado) {
  let porConsulta = memoDeResultado.get(payload);
  if (!porConsulta) {
    porConsulta = new Map();
    memoDeResultado.set(payload, porConsulta);
  }
  if (!porConsulta.has(consulta) && porConsulta.size >= MEMO_POR_PAGINA) {
    porConsulta.delete(porConsulta.keys().next().value);
  }
  porConsulta.set(consulta, resultado);
  return resultado;
}

/**
 * Converte e pontua uma página para a consulta.
 *
 * A parada antecipada da conversão pode deixar o assunto no rabo não
 * convertido. Sem NENHUM casamento na frente, vale converter a página inteira
 * antes de dizer "não achei": é melhor pagar a conversão completa uma vez do
 * que devolver um falso negativo.
 */
function resultadoDaBusca(payload, consulta, termos) {
  const guardado = lerMemo(payload, consulta);
  if (guardado) return guardado;

  const { text: html, finalUrl, contentType } = payload;
  ensureHtml(contentType, html, finalUrl);

  const bruto = isConteudoBruto(contentType, html);
  let conteudo = bruto ? html.replace(/\r\n?/g, "\n") : markdownMemo(payload);
  let interrompida = !bruto && markdownInterrompida(payload);

  let blocos = blocosDoMarkdown(conteudo);
  let achados = pontuarBlocos(blocos, termos);

  if (interrompida && achados.length === 0) {
    conteudo = markdownCompleto(payload);
    interrompida = false;
    blocos = blocosDoMarkdown(conteudo);
    achados = pontuarBlocos(blocos, termos);
  }

  return guardarMemo(payload, consulta, {
    finalUrl,
    conteudo,
    totalBlocos: blocos.length,
    achados,
    interrompida,
  });
}

/**
 * Aviso de cobertura: diz se a busca viu a página inteira ou só um pedaço.
 * Dois motivos diferentes, o mesmo cuidado — nunca deixar a IA achar que
 * "não achei" significa "não existe".
 */
function avisoCobertura(payload, resultado) {
  if (payload.cortado) {
    return (
      `\nAVISO: documento maior que o teto de download — a busca cobre apenas os primeiros ` +
      `${payload.bytes} bytes, nao a pagina inteira.`
    );
  }
  if (resultado.interrompida) {
    return (
      `\nAVISO: a pagina e grande demais para converter inteira — a busca cobriu os primeiros ` +
      `${resultado.conteudo.length} caracteres do texto extraido, nao a pagina toda. ` +
      `O assunto pode estar no resto.`
    );
  }
  return "";
}

function termosDaConsultaOuErro(consulta) {
  const termos = termosDaConsulta(consulta);
  if (termos.length === 0) {
    throw new ParametroInvalidoError(
      "query",
      "a consulta so tem palavras vazias (onde, fica, dos...); informe o assunto, ex.: 'baús'"
    );
  }
  return termos;
}

function avisoDeAchadoFraco(termos, achados) {
  if (achados.length === 0) return "";
  const termosVistos = new Set(achados.flatMap((a) => a.casados)).size;
  const melhorNota = achados[0].nota;
  if (termosVistos > Math.floor(termos.length / 2) && melhorNota >= 1.5) return "";
  return (
    `\n\nAVISO: achado fraco — ${termosVistos} de ${termos.length} termo(s) aparecem e o melhor ` +
    `trecho tem relevancia ${melhorNota}. Se nao responder a pergunta, leia a pagina com read_page.`
  );
}

/**
 * Ferramenta find_relevant: busca por trechos numa página.
 */
export async function toolFindRelevant(args = {}) {
  const parsed = validateHttpUrl(args.url);
  const consulta = String(args.query ?? "").trim();
  if (!consulta) throw new ParametroInvalidoError("query", "informe o assunto a buscar");
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  // `Number(...) || 5` transformaria o 0 num pedido de 5; zero não faz sentido
  // aqui, mas lixo/ausência é que viram o padrão.
  const maxTrechos = inteiroOuPadrao(args.maxTrechos, 5, 1, 20);
  const termos = termosDaConsultaOuErro(consulta);

  const payload = await fetchTextDocumentoCached(parsed.href, { timeoutMs });
  const resultado = resultadoDaBusca(payload, consulta, termos);
  const aviso = avisoCobertura(payload, resultado);
  const listaTermos = termos.map((t) => t.palavra).join(", ");

  if (resultado.achados.length === 0) {
    return (
      `Nenhum trecho relevante para "${consulta}" em ${resultado.finalUrl}.\n` +
      `Termos usados (sem as palavras vazias): ${listaTermos}.\n` +
      `A pagina tem ${resultado.totalBlocos} bloco(s) de texto e ${resultado.conteudo.length} caracteres. ` +
      `Tente palavras mais especificas ou leia a pagina com read_page.` +
      aviso
    );
  }

  const melhores = resultado.achados.slice(0, maxTrechos);
  const cabecalho =
    `# Trechos relevantes em: ${resultado.finalUrl}\n` +
    `Consulta: "${consulta}" | termos usados: ${listaTermos}\n` +
    `Trechos: ${melhores.length} de ${resultado.achados.length} bloco(s) com casamento` +
    aviso;

  const trechos = melhores.map((bloco, i) => {
    const rotuloSecao = bloco.secao ? ` — secao: ${bloco.secao}` : "";
    return `## ${i + 1}. relevancia ${bloco.nota}${rotuloSecao}\n${recortarTrecho(bloco.texto)}`;
  });

  return cabecalho + "\n\n" + trechos.join("\n\n") + avisoDeAchadoFraco(termos, resultado.achados);
}

/**
 * Ferramenta find_relevant_multi: a mesma busca em várias páginas.
 *
 * As páginas são baixadas em paralelo (no máximo 8, abaixo do limite global
 * de conexões do servidor) e cada uma devolve até `maxPorFonte` trechos.
 * Depois os trechos de todas as fontes são ordenados pela nota e cortados em
 * `maxTrechos` — assim uma página excepcional não soterra as outras: o teto
 * por fonte é distribuído antes.
 *
 * Falha de uma URL não derruba a chamada: ela entra na lista de erros e as
 * demais seguem. Requisição de várias fontes é justamente onde uma some.
 */
export async function toolFindRelevantMulti(args = {}) {
  const urls = Array.isArray(args.urls) ? args.urls.map((u) => String(u)) : [];
  if (urls.length === 0) throw new ParametroInvalidoError("urls", "informe a lista de paginas onde buscar");
  if (urls.length > MAX_FONTES_MULTI) {
    throw new LimiteExcedidoError("URLs", MAX_FONTES_MULTI, urls.length);
  }
  const consulta = String(args.query ?? "").trim();
  if (!consulta) throw new ParametroInvalidoError("query", "informe o assunto a buscar");
  const termos = termosDaConsultaOuErro(consulta);
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  const maxTrechos = inteiroOuPadrao(args.maxTrechos, 6, 1, MAX_TRECHOS_MULTI);
  const maxPorFonte = inteiroOuPadrao(args.maxPorFonte, 2, 1, 5);

  // Duas variações da mesma página (utm_*, parâmetros em outra ordem) são uma
  // leitura só, como no resto do servidor.
  const unicas = [];
  const vistas = new Set();
  for (const url of urls) {
    const chave = chaveCanonica(url);
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    unicas.push(url);
  }

  const fontes = await Promise.all(
    unicas.map(async (url) => {
      try {
        const parsed = validateHttpUrl(url);
        const payload = await fetchTextDocumentoCached(parsed.href, { timeoutMs });
        return { url, ok: true, payload, resultado: resultadoDaBusca(payload, consulta, termos) };
      } catch (err) {
        return { url, ok: false, erro: String((err && err.message) || err) };
      }
    })
  );

  const listaTermos = termos.map((t) => t.palavra).join(", ");
  const lidas = fontes.filter((f) => f.ok).length;

  const candidatos = [];
  for (const fonte of fontes) {
    if (!fonte.ok) continue;
    for (const achado of fonte.resultado.achados.slice(0, maxPorFonte)) {
      candidatos.push({ fonte, achado });
    }
  }
  candidatos.sort((a, b) => b.achado.nota - a.achado.nota);
  const escolhidos = candidatos.slice(0, maxTrechos);

  const erros = fontes.filter((f) => !f.ok);
  const semCasamento = fontes.filter((f) => f.ok && f.resultado.achados.length === 0);

  if (escolhidos.length === 0) {
    const linhas = [
      `Nenhum trecho relevante para "${consulta}" nas ${unicas.length} pagina(s).`,
      `Termos usados (sem as palavras vazias): ${listaTermos}.`,
    ];
    for (const fonte of fontes) {
      if (fonte.ok) {
        linhas.push(
          `- ${fonte.resultado.finalUrl}: ${fonte.resultado.totalBlocos} bloco(s), ${fonte.resultado.achados.length} com casamento.`
        );
      } else {
        linhas.push(`- ${urlSemCredenciais(fonte.url)}: falhou — ${fonte.erro}`);
      }
    }
    linhas.push(`Tente palavras mais especificas ou leia as paginas com read_page.`);
    for (const fonte of fontes) {
      if (fonte.ok) {
        const aviso = avisoCobertura(fonte.payload, fonte.resultado);
        if (aviso) linhas.push(aviso.trim());
      }
    }
    return linhas.join("\n");
  }

  const grupos = new Map();
  for (const { fonte, achado } of escolhidos) {
    const chave = fonte.resultado.finalUrl;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(achado);
  }

  const cabecalho =
    `# Trechos relevantes em varias paginas\n` +
    `Consulta: "${consulta}" | termos usados: ${listaTermos}\n` +
    `Paginas: ${lidas} de ${unicas.length} lidas | trechos: ${escolhidos.length} de ${candidatos.length} candidato(s)`;

  const secoes = [];
  let posicao = 1;
  for (const [url, trechos] of grupos) {
    const linhas = [`## ${posicao++}. ${url} (${trechos.length} trecho(s))`];
    for (const bloco of trechos) {
      const rotuloSecao = bloco.secao ? ` — secao: ${bloco.secao}` : "";
      linhas.push(`### relevancia ${bloco.nota}${rotuloSecao}`);
      linhas.push(recortarTrecho(bloco.texto));
    }
    secoes.push(linhas.join("\n"));
  }

  const avisos = [];
  for (const fonte of fontes) {
    if (!fonte.ok) continue;
    const aviso = avisoCobertura(fonte.payload, fonte.resultado);
    if (aviso) avisos.push(`- ${fonte.resultado.finalUrl}:${aviso.slice(1)}`);
  }
  for (const fonte of semCasamento) {
    avisos.push(
      `- ${fonte.resultado.finalUrl}: nenhum trecho com casamento (${fonte.resultado.totalBlocos} bloco(s)).`
    );
  }
  for (const fonte of erros) {
    avisos.push(`- ${urlSemCredenciais(fonte.url)}: falhou — ${fonte.erro}`);
  }

  const todosAchados = candidatos.map((c) => c.achado);
  const aviso =
    (avisos.length ? `\n\n## Avisos de cobertura\n${avisos.join("\n")}` : "") +
    avisoDeAchadoFraco(termos, todosAchados);

  return cabecalho + "\n\n" + secoes.join("\n\n") + aviso;
}
