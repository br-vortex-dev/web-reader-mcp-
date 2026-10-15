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
      const item = peek();
      if (item) {
        itens[cabeca] = undefined;
        cabeca++;
        pendentes--;
      }
      return item;
    },
    cancelar: (item) => {
      if (!item.decidido) {
        item.decidido = true;
        pendentes--;
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
          fila.cancelar(entrada);
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
    ativos--;
    atender();
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
          fila.cancelar(entrada);
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
 */
export class CacheLRU {
  constructor({ ttlMs, maxEntries, maxBytes, maxEntryBytes }) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.maxEntryBytes = maxEntryBytes;
    this.map = new Map();
    this.bytes = 0;
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.at >= this.ttlMs) {
      this.delete(key);
      return undefined;
    }
    // LRU touch: reordena sem mexer no total de bytes.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.payload;
  }

  set(key, payload, bytes) {
    this.delete(key); // sobrescrever a mesma chave não conta duas vezes
    this.map.set(key, { at: Date.now(), payload, bytes });
    this.bytes += bytes;
    // Despeja os menos recentemente usados até caber nos DOIS tetos.
    while (this.map.size > 1 && (this.map.size > this.maxEntries || this.bytes > this.maxBytes)) {
      const maisAntiga = this.map.keys().next().value;
      if (maisAntiga === key) break;
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
    };
  }

  cleanup() {
    const cutoff = Date.now() - this.ttlMs;
    for (const [key, entry] of this.map) {
      if (entry.at < cutoff) this.delete(key);
    }
  }
}
