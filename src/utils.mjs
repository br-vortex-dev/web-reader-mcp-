/**
 * Utilitários: fila FIFO, limitadores de concorrência e bytes, cache LRU.
 */

import { ServidorOcupadoError } from "./errors.mjs";

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
    while (cabeca < itens.length && itens[cabeca].decidido) {
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
    // Tira uma entrada especifica da fila. So pode ser chamado DEPOIS de
    // marcar a entrada como decidida: sem isso o item rejeitado continuaria na
    // fila e um liberar() futuro chamaria o resolve() dele de novo.
    remover: (item) => {
      const posicao = itens.indexOf(item, cabeca);
      if (posicao === -1) return;
      itens[posicao] = undefined;
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
