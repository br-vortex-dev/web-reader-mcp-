/**
 * warmer.mjs — o aquecedor de cache: mantém quentes as páginas mais pedidas.
 *
 * O QUE É
 *   Um trabalho de fundo que, de tempos em tempos, revalida as URLs que os
 *   clientes mais pedem — antes de a entrada vencer. Numa página popular, a
 *   primeira leitura depois do TTL paga a espera do site de novo (a leitura
 *   quente custa ~220 ms; a fria, 377–1500 ms nas medições de produção). Com
 *   o aquecedor, essa primeira leitura encontra a entrada renovada.
 *
 * O QUE ELE NÃO FAZ
 *   Não busca URLs que ninguém pediu, não aquece página que não CABE no cache
 *   (acima do teto de uma entrada, aquecer seria baixar para descartar) e não
 *   compete com o tráfego: a rodada é serial, com poucas URLs e prazo próprio.
 *   Desligado por padrão (CACHE_WARMER=1 liga; produção liga no render.yaml),
 *   porque fazer chamadas de rede por conta própria é comportamento que a
 *   suíte sem a env não deve assumir.
 *
 * QUEM USA
 *   tools.mjs registra cada leitura concluída; server.js (modo HTTP) liga o
 *   relógio; http-transport.mjs lê os contadores no /health. Usa fetch.mjs
 *   para revalidar e o cache para saber a idade da entrada.
 */

import {
  CACHE_MAX_ENTRY_BYTES,
  CACHE_TTL_MS,
  CACHE_WARMER,
  CACHE_WARMER_INTERVAL_MS,
  CACHE_WARMER_JANELA_MS,
  CACHE_WARMER_MARGEM_MS,
  CACHE_WARMER_MAX_URLS,
  CACHE_WARMER_MIN_PEDIDOS,
  CACHE_WARMER_TIMEOUT_MS,
  SERVER_NAME,
} from "./config.mjs";
import { chaveCanonica } from "./utils.mjs";
import { idadeNoCache, reaquecerNoCache } from "./fetch.mjs";

// Teto do placar de URLs observadas. Cada leitura de uma URL nova ocupa uma
// posição; acima disto a menos recentemente pedida sai (Map reordenado a cada
// pedido, então a primeira chave é sempre a mais fria).
const MAX_ENTRADAS = 2048;

// chaveCanonica -> { pedidos, ultimo, falhas }
const pedidos = new Map();

const contadores = { aquecidas: 0, falhas: 0 };
let timer = null;
let emRodada = false;

/**
 * Registra UMA leitura concluída de uma página. Só entra no placar o que pode
 * ser aquecido: página acima do teto de uma entrada do cache nunca ficaria
 * quente, e um corte sem tamanho declarado não diz se a página cabe.
 */
export function registrarPedidoQuente(url, payload) {
  if (!CACHE_WARMER) return;
  const tamanho = payload.bytesDeclarados || (payload.cortado ? 0 : payload.bytes);
  if (!tamanho || tamanho > CACHE_MAX_ENTRY_BYTES) return;
  const chave = chaveCanonica(url);
  let info = pedidos.get(chave);
  if (info) {
    // Reinserir move para o fim: a ordem do Map vira a ordem de recência.
    pedidos.delete(chave);
  } else if (pedidos.size >= MAX_ENTRADAS) {
    pedidos.delete(pedidos.keys().next().value);
  }
  info = info || { pedidos: 0, ultimo: 0, falhas: 0 };
  info.pedidos++;
  info.ultimo = Date.now();
  pedidos.set(chave, info);
}

async function rodada() {
  if (emRodada) return;
  emRodada = true;
  try {
    const agora = Date.now();
    for (const [chave, info] of pedidos) {
      if (agora - info.ultimo > CACHE_WARMER_JANELA_MS) pedidos.delete(chave);
    }
    const candidatos = [...pedidos.entries()]
      .filter(([, info]) => info.pedidos >= CACHE_WARMER_MIN_PEDIDOS && info.falhas < 3)
      .sort((a, b) => b[1].pedidos - a[1].pedidos || b[1].ultimo - a[1].ultimo)
      .slice(0, CACHE_WARMER_MAX_URLS);

    // Serial de propósito: é trabalho de fundo, não pode competir com quem
    // está esperando uma leitura de verdade.
    for (const [chave, info] of candidatos) {
      const idade = idadeNoCache(chave);
      // Fresca e longe do vencimento: nada a fazer nesta rodada.
      if (idade >= 0 && idade < CACHE_TTL_MS - CACHE_WARMER_MARGEM_MS) continue;
      try {
        await reaquecerNoCache(chave, { timeoutMs: CACHE_WARMER_TIMEOUT_MS });
        info.falhas = 0;
        contadores.aquecidas++;
      } catch {
        info.falhas++;
        contadores.falhas++;
        // Três falhas seguidas: a URL sai do placar até alguém pedi-la de novo
        // (aí volta com o contador zerado).
        if (info.falhas >= 3) pedidos.delete(chave);
      }
    }
  } finally {
    emRodada = false;
  }
}

/**
 * Liga o relógio do aquecedor. Devolve o timer (ou null quando desligado).
 * O `.unref()` é o que mantém o processo encerrando normalmente no shutdown.
 */
export function iniciarAquecedor() {
  if (!CACHE_WARMER) return null;
  if (timer) return timer;
  timer = setInterval(rodada, CACHE_WARMER_INTERVAL_MS);
  timer.unref();
  console.error(
    `[${SERVER_NAME}] aquecedor de cache ligado: rodada a cada ${Math.round(CACHE_WARMER_INTERVAL_MS / 1000)}s, ` +
      `até ${CACHE_WARMER_MAX_URLS} URL(s), janela de ${Math.round(CACHE_WARMER_JANELA_MS / 60000)} min.`
  );
  return timer;
}

/** Contadores para o /health. */
export function estatisticasAquecedor() {
  return {
    ligado: CACHE_WARMER,
    quentes: pedidos.size,
    aquecidas: contadores.aquecidas,
    falhas: contadores.falhas,
  };
}
