/**
 * utils.mjs — as peças de infraestrutura que não sabem nada de web.
 *
 * O QUE É
 *   Quatro utilidades genéricas, cada uma resolvendo um problema que aparece
 *   em vários pontos do projeto:
 *   - chaveCanonica: a MESMA página chega com utm_*, gclid, fbclid... Sem
 *     normalizar, cada variação seria outra URL (baixa de novo, converte de
 *     novo, ocupa outra vaga no cache).
 *   - criarFila: fila FIFO para não disparar tudo de uma vez.
 *   - criarLimitador / criarLimitadorDeBytes / criarLimitadorPorChave: quantas
 *     requisições cabem ao mesmo tempo, no total e por host.
 *   - CacheLRU: cache com teto de entradas e de bytes, que despeja o mais
 *     antigo quando enche.
 *
 * O QUE ENTRA / O QUE SAI
 *   Entra: uma URL, ou os parâmetros do limitador (concorrência, teto).
 *   Sai:   a chave normalizada, ou um objeto com o método que você chama
 *          (`fila.executar(fn)`, `cache.obter(chave)`).
 *
 * Nada aqui faz rede: é só controle de fluxo, memória e endereço.
 *
 * QUEM USA
 *   Usado por: fetch, security, snapshot.
 */

import { ServidorOcupadoError } from "./errors.mjs";

/* ============================ URL canônica ============================ *
 * A mesma página chega com parâmetros de rastreio a cada clique/`share`
 * (utm_*, gclid, fbclid...). Sem normalizar, cada variação vira uma URL
 * diferente: baixa de novo, converte de novo e ocupa uma vaga do cache. A
 * chave canônica descarta esses parâmetros — o conteúdo é o mesmo — e a
 * ordem dos demais parâmetros passa a não importar.
 * ======================================================================= */

// Parâmetros que só carregam rastreio/marketing: descartados da chave.
const PARAMS_RASTREIO = new Set([
  "gclid",
  "fbclid",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
  "igshid",
  "s_kwcid",
  "yclid",
  "twclid",
  "vero_id",
]);

/** É parâmetro de rastreio? (utm_* por prefixo, os demais por nome exato.) */
export function ehParamRastreio(chave) {
  const k = String(chave).toLowerCase();
  return k.startsWith("utm_") || PARAMS_RASTREIO.has(k);
}

/**
 * Devolve a chave canônica de uma URL: sem parâmetros de rastreio e com os
 * demais ordenados (para ?a=1&b=2 e ?b=2&a=1 casarem). URL inválida volta
 * como o próprio texto — a validação de verdade acontece depois, no fetch.
 *
 * A barra final e o fragmento (#...) também são normalizados: o servidor
 * entrega o mesmo conteúdo, então não vale pagar dois downloads.
 */
export function chaveCanonica(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return String(url);
  }
  const limpos = [];
  for (const [k, v] of u.searchParams) {
    if (!ehParamRastreio(k)) limpos.push([k, v]);
  }
  limpos.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  u.search = "";
  for (const [k, v] of limpos) u.searchParams.append(k, v);
  u.hash = "";
  // "/" e "" são a mesma home; unifica para não duplicar entrada.
  if (u.pathname === "/") u.pathname = "";
  return u.href;
}

/**
 * Fila FIFO com índice de cabeça (evita shift()/splice() O(n)).
 */
export function criarFila() {
  let itens = [];
  let cabeca = 0;
  let pendentes = 0;

  const compactar = () => {
    if (cabeca > 1024 && cabeca * 2 >= itens.length) {
      itens = itens.slice(cabeca);
      cabeca = 0;
    }
  };

  const peek = () => {
    // A posicao tambem pode estar VAZIA (remover() apaga a entrada no lugar):
    // sem a guarda, ler .decidido de um buraco quebrava com TypeError e
    // derrubava o liberar() seguinte.
    while (cabeca < itens.length && (!itens[cabeca] || itens[cabeca].decidido)) {
      itens[cabeca] = undefined;
      cabeca++;
    }
    compactar();
    return cabeca < itens.length ? itens[cabeca] : undefined;
  };

  return {
    get tamanho() {
      return pendentes;
    },
    push: (item) => {
      itens.push(item);
      pendentes++;
    },
    peek,
    shift: () => {
      // So pode sair quem ainda nao foi decidido: sem isso uma entrada
      // rejeitada (fila cheia, espera esgotada) continuava no array e um
      // liberar() futuro resolvia a promessa dela de novo.
      const item = peek();
      if (!item || item.decidido) return undefined;
      itens[cabeca] = undefined;
      cabeca++;
      pendentes--;
      // Se a fila esvaziou pela direita, libera o array: sem isso uma fila
      // que so esvazia (toda entrada atendida/recusada) mantem o array
      // alocado para sempre.
      if (pendentes === 0) {
        itens = [];
        cabeca = 0;
      }
      return item;
    },
    cancelar: (item) => {
      if (!item.decidido) {
        item.decidido = true;
        pendentes--;
      }
    },
    // Tira uma entrada especifica da fila e desconta a contagem UMA vez.
    // Quem desiste da espera (teto estourado) tem de sair de verdade: sem o
    // desconto, a entrada rejeitada continuava contando em stats.naFila e a
    // fila so PARECIA cheia; com o buraco no array, o peek() seguinte ainda
    // quebrava com TypeError.
    remover: (item) => {
      if (!item.decidido) {
        item.decidido = true;
        pendentes--;
      }
      const posicao = itens.indexOf(item, cabeca);
      if (posicao !== -1) itens[posicao] = undefined;
      if (pendentes === 0) {
        itens = [];
        cabeca = 0;
      }
    },
  };
}

/**
 * Limitador por BYTES em voo (semáforo ponderado, fila limitada).
 * Permite muitas páginas pequenas simultaneamente e limita as grandes.
 */
export function criarLimitadorDeBytes({ orcamentoBytes, filaMax, nome, esperaMaxMs = 0 }) {
  let usado = 0;
  const fila = criarFila();
  const stats = { nome, orcamentoBytes, usado: 0, naFila: 0, recusados: 0, atendidos: 0, picoUsado: 0, picoFila: 0 };

  const sincronizar = () => {
    stats.usado = usado;
    stats.naFila = fila.tamanho;
    stats.picoUsado = Math.max(stats.picoUsado, usado);
    stats.picoFila = Math.max(stats.picoFila, fila.tamanho);
  };

  const ocupado = () => new ServidorOcupadoError(nome, usado, fila.tamanho);

  const ajustar = (bytes) => Math.max(1, Math.min(bytes, orcamentoBytes));

  const tentarAtender = () => {
    for (;;) {
      const item = fila.peek();
      if (!item) break;
      if (usado + item.bytes > orcamentoBytes) break;
      fila.shift();
      if (item.timer) clearTimeout(item.timer);
      item.decidido = true;
      usado += item.bytes;
      item.resolve();
    }
    sincronizar();
  };

  const adquirir = (bytes) => {
    const pedido = ajustar(bytes);
    if (fila.tamanho === 0 && usado + pedido <= orcamentoBytes) {
      usado += pedido;
      sincronizar();
      return Promise.resolve();
    }
    if (fila.tamanho >= filaMax) {
      stats.recusados++;
      return Promise.reject(ocupado());
    }
    return new Promise((resolve, reject) => {
      const entrada = { bytes: pedido, resolve, reject, decidido: false, timer: null };
      if (esperaMaxMs > 0) {
        entrada.timer = setTimeout(() => {
          if (entrada.decidido) return;
          fila.remover(entrada);
          stats.recusados++;
          sincronizar();
          reject(ocupado());
        }, esperaMaxMs);
        entrada.timer.unref();
      }
      fila.push(entrada);
      sincronizar();
    });
  };

  const liberar = (bytes) => {
    usado = Math.max(0, usado - ajustar(bytes));
    stats.atendidos++;
    tentarAtender();
  };

  return { adquirir, liberar, stats };
}

/**
 * Limitador de concorrência com fila limitada.
 */
export function criarLimitador({ limite, filaMax, nome, esperaMaxMs = 0 }) {
  let ativos = 0;
  const fila = criarFila();
  const stats = { nome, limite, filaMax, ativos: 0, naFila: 0, recusados: 0, atendidos: 0, picoAtivos: 0, picoFila: 0 };

  const sincronizar = () => {
    stats.ativos = ativos;
    stats.naFila = fila.tamanho;
    stats.picoAtivos = Math.max(stats.picoAtivos, ativos);
    stats.picoFila = Math.max(stats.picoFila, fila.tamanho);
  };

  const ocupado = () => new ServidorOcupadoError(nome, ativos, fila.tamanho);

  const atender = () => {
    const item = fila.shift();
    if (!item) return;
    if (item.timer) clearTimeout(item.timer);
    item.decidido = true;
    ativos++;
    item.resolve();
  };

  const liberar = () => {
    // So desconta se havia vaga ocupada: um liberar() a mais (ou um liberar()
    // solto no fim de um fluxo que nao adquiriu) nao pode deixar o contador
    // negativo nem liberar vaga que nao existe.
    if (ativos > 0) {
      ativos--;
      atender();
    }
    sincronizar();
  };

  const adquirir = () => {
    if (ativos < limite) {
      ativos++;
      sincronizar();
      return Promise.resolve();
    }
    if (fila.tamanho >= filaMax) {
      stats.recusados++;
      return Promise.reject(ocupado());
    }
    return new Promise((resolve, reject) => {
      const entrada = { decidido: false, timer: null, resolve, reject };
      if (esperaMaxMs > 0) {
        entrada.timer = setTimeout(() => {
          if (entrada.decidido) return;
          fila.remover(entrada);
          stats.recusados++;
          sincronizar();
          reject(ocupado());
        }, esperaMaxMs);
        entrada.timer.unref();
      }
      fila.push(entrada);
      sincronizar();
    });
  };

  const executar = async (fn) => {
    await adquirir();
    try {
      const resultado = await fn();
      stats.atendidos++;
      return resultado;
    } finally {
      liberar();
    }
  };

  return { executar, adquirir, liberar, stats };
}

/**
 * Limitador de concorrência POR CHAVE (ex.: por host): cada chave tem o seu
 * próprio teto de simultaneidade e a sua própria fila. É a garantia de
 * justiça entre sites — um site lento não consome todas as vagas de download
 * enquanto os outros esperam (o teto global continua valendo por cima).
 *
 * Contratos:
 * - `executar(chave, fn)`: espera a vaga DA CHAVE e roda `fn`.
 * - Fila cheia para a chave -> ServidorOcupadoError na hora (não trava).
 * - `esperaMaxMs` > 0: quem espera demais desiste com o mesmo erro (e sai
 *   da contagem da fila, como no limitador simples).
 * - Chave sem ninguém ativo nem esperando sai do mapa: o estado não cresce
 *   com hosts que passaram por aqui.
 */
/**
 * Cria o item de fila de UMA chave, com o prazo de espera opcional.
 *
 * O item existe para resolver uma corrida real: entre entrar na fila e ser
 * atendido, o prazo pode estourar. `decidido` marca que a sorte já foi
 * lançada (atendido OU desistiu), e quem chega depois vê a marca e não age —
 * sem isso, o timeout podia recusar uma vaga que já tinha sido dada.
 *
 * Devolve a promessa que o chamador aguarda.
 */
function enfileirarNaChave({ entrada, chave, esperaMaxMs, aoDesistir, aoEntrarNaFila, ocupado }) {
  return new Promise((resolve, reject) => {
    const item = { decidido: false, timer: null, resolve, reject };
    if (esperaMaxMs > 0) {
      item.timer = setTimeout(() => {
        if (item.decidido) return;
        entrada.fila.remover(item);
        aoDesistir();
        reject(ocupado());
      }, esperaMaxMs);
      item.timer.unref();
    }
    entrada.fila.push(item);
    aoEntrarNaFila();
  });
}

export function criarLimitadorPorChave({ limite, filaMax, nome, esperaMaxMs = 0 }) {
  const porChave = new Map();
  const stats = {
    nome,
    limite,
    filaMax,
    chaves: 0,
    ativos: 0,
    naFila: 0,
    recusados: 0,
    atendidos: 0,
    picoAtivos: 0,
    picoFila: 0,
  };

  const ajustar = (dAtivos, dFila) => {
    stats.ativos += dAtivos;
    stats.naFila += dFila;
    stats.picoAtivos = Math.max(stats.picoAtivos, stats.ativos);
    stats.picoFila = Math.max(stats.picoFila, stats.naFila);
  };

  const estado = (chave) => {
    let entrada = porChave.get(chave);
    if (!entrada) {
      entrada = { ativos: 0, fila: criarFila() };
      porChave.set(chave, entrada);
      stats.chaves = porChave.size;
    }
    return entrada;
  };

  const limparSeOcioso = (chave, entrada) => {
    if (entrada.ativos === 0 && entrada.fila.tamanho === 0) {
      porChave.delete(chave);
      stats.chaves = porChave.size;
    }
  };

  const ocupado = (chave, entrada) =>
    new ServidorOcupadoError(`${nome} (${chave})`, entrada.ativos, entrada.fila.tamanho);

  const atender = (chave, entrada) => {
    const item = entrada.fila.shift();
    if (!item) return;
    if (item.timer) clearTimeout(item.timer);
    item.decidido = true;
    entrada.ativos++;
    ajustar(+1, -1);
    item.resolve();
  };

  const liberar = (chave) => {
    const entrada = porChave.get(chave);
    if (!entrada) return;
    if (entrada.ativos > 0) {
      entrada.ativos--;
      ajustar(-1, 0);
      atender(chave, entrada);
    }
    limparSeOcioso(chave, entrada);
  };

  const adquirir = (chave) => {
    const entrada = estado(chave);
    // Caminho feliz: tem vaga nesta chave agora.
    if (entrada.ativos < limite) {
      entrada.ativos++;
      ajustar(+1, 0);
      return Promise.resolve();
    }
    // Fila da chave cheia: recusa na hora, sem travar o chamador.
    if (entrada.fila.tamanho >= filaMax) {
      stats.recusados++;
      return Promise.reject(ocupado(chave, entrada));
    }
    return enfileirarNaChave({
      entrada,
      chave,
      esperaMaxMs,
      ocupado: () => ocupado(chave, entrada),
      aoDesistir: () => {
        stats.recusados++;
        ajustar(0, -1);
        limparSeOcioso(chave, entrada);
      },
      aoEntrarNaFila: () => ajustar(0, +1),
    });
  };

  const executar = async (chave, fn) => {
    await adquirir(chave);
    try {
      const resultado = await fn();
      stats.atendidos++;
      return resultado;
    } finally {
      liberar(chave);
    }
  };

  return { executar, adquirir, liberar, stats };
}

/**
 * Coalescedor de buscas em voo (single-flight).
 *
 * Vários pedidos da MESMA chave feitos enquanto a busca ainda está em
 * andamento aguardam a MESMA promessa, em vez de disparar buscas paralelas.
 * É o que impede uma rajada de N usuários nas mesmas URLs de virar N
 * downloads: o primeiro inicia; os demais caronam (e o cache só precisa
 * "esquentar" uma vez).
 *
 * Contratos:
 * - `executar(chave, fn)`: já há busca em voo para a chave? devolve a
 *   promessa dela (sem chamar `fn`); senão chama `fn`, guarda e devolve.
 * - A entrada sai da tabela quando a busca termina — a próxima chamada
 *   tenta de novo (o cache de páginas decide se precisa mesmo baixar).
 * - A promessa guardada recebe um handler no-op: se todos os que esperavam
 *   desistirem, uma rejeição compartilhada NÃO vira "unhandled rejection"
 *   (que neste projeto derruba o processo de propósito).
 * - `stats.colapsadas` conta os pedidos que caronaram (não iniciaram busca).
 */
export function criarCoalescedorDeBuscas() {
  const emVoo = new Map();
  const stats = { emVoo: 0, colapsadas: 0 };

  const executar = (chave, fn) => {
    const existente = emVoo.get(chave);
    if (existente) {
      stats.colapsadas++;
      return existente;
    }
    const busca = Promise.resolve().then(fn);
    emVoo.set(chave, busca);
    stats.emVoo = emVoo.size;
    const limpar = () => {
      if (emVoo.get(chave) === busca) {
        emVoo.delete(chave);
        stats.emVoo = emVoo.size;
      }
    };
    busca.then(limpar, limpar);
    busca.catch(() => {
      // consumida pelo coalescedor: quem espera ainda vê a rejeição na própria promessa
    });
    return busca;
  };

  return { executar, stats };
}

/**
 * Cache LRU + TTL com teto em bytes.
 * Stale-while-revalidate (quando `staleWhileRevalidate=true`): entradas expiradas
 * dentro da janela de graça (staleWindowMs) são devolvidas com `stale: true` e
 * atualizadas em background pelo caller — assim uma página que acabou de vencer
 * não bloqueia a resposta atrás de uma nova busca. Com ele desligado (padrão,
 * o comportamento que a suíte assume), expirada = busca de novo.
 */
export class CacheLRU {
  constructor({ ttlMs, maxEntries, maxBytes, staleWindowMs = ttlMs * 2, staleWhileRevalidate = false }) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.staleWindowMs = staleWindowMs;
    this.staleWhileRevalidate = staleWhileRevalidate;
    this.map = new Map();
    this.bytes = 0;
    this.staleHits = 0;
  }

  /**
   * Retorna { payload, stale } — stale=true significa que a entrada está
   * expirada mas dentro da janela de graça; o caller deve atualizar em background.
   */
  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;

    const age = Date.now() - entry.at;
    const stale = age >= this.ttlMs;

    if (stale) {
      if (!this.staleWhileRevalidate || age >= this.staleWindowMs) {
        // Sem stale-while-revalidate (ou já fora da janela de graça) — remove e
        // deixa o caller buscar de novo.
        this.delete(key);
        return undefined;
      }
      // Stale-while-revalidate: serve imediatamente e atualiza em background.
      this.staleHits++;
      this.map.delete(key);
      this.map.set(key, entry);
      return { payload: entry.payload, stale: true };
    }

    // LRU touch: reordena sem mexer no total de bytes.
    this.map.delete(key);
    this.map.set(key, entry);
    return { payload: entry.payload, stale: false };
  }

  set(key, payload, bytes) {
    this.delete(key); // sobrescrever a mesma chave não conta duas vezes
    this.map.set(key, { at: Date.now(), payload, bytes });
    this.bytes += bytes;
    // Despeja os menos recentemente usados até caber nos DOIS tetos.
    // Para quando nao sobra ninguem para despejar (so a propria chave) OU
    // quando a entrada e maior que o teto inteiro — nesse caso nao ha o que
    // despejar, e o loop antigo girava para sempre travando o processo.
    while (this.map.size > 1 && (this.map.size > this.maxEntries || this.bytes > this.maxBytes)) {
      const maisAntiga = this.map.keys().next().value;
      if (maisAntiga === key || this.map.get(maisAntiga).bytes >= this.bytes) break;
      this.delete(maisAntiga);
    }
  }

  delete(key) {
    const entry = this.map.get(key);
    if (!entry) return;
    this.bytes -= entry.bytes;
    this.map.delete(key);
    if (this.bytes < 0) this.bytes = 0;
  }

  get size() {
    return this.map.size;
  }

  stats() {
    return {
      entries: this.map.size,
      bytes: this.bytes,
      maxBytes: this.maxBytes,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
      staleHits: this.staleHits,
    };
  }

  cleanup() {
    const cutoff = Date.now() - this.staleWindowMs;
    for (const [key, entry] of this.map) {
      if (entry.at < cutoff) this.delete(key);
    }
  }
}
