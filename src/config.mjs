/**
 * Configuração central do web-reader-mcp.
 * Todos os tetos, timeouts e defaults do servidor ficam aqui.
 */

export const SERVER_NAME = "web-reader";
export const SERVER_VERSION = "1.7.1";

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const ALT_USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
];

export const PROTOCOL_VERSIONS = new Set([
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
]);

// Timeout padrão de cada requisição HTTP (configurável por DEFAULT_TIMEOUT_MS).
export const DEFAULT_TIMEOUT_MS = clampEnv(process.env.DEFAULT_TIMEOUT_MS, 8000, 1000, 60000);

// Tetos de saída de texto.
export const HARD_MAX_CHARS = 25000;
export const DEFAULT_MAX_CHARS = clampEnv(process.env.DEFAULT_MAX_CHARS, 8000, 200, HARD_MAX_CHARS);

// Teto de páginas por chamada em read_multiple_pages e crawl_site.
export const MAX_PAGES_PER_CALL = 30;

// Teto de download por requisição.
export const MAX_RESPONSE_BYTES = Math.max(
  64 * 1024,
  Math.floor(Number(process.env.MAX_RESPONSE_BYTES) || 5 * 1024 * 1024)
);

// Concorrência de downloads (sockets/tarefas simultâneas).
// 32 permite que read_multiple_pages e crawl_site processem lotes maiores sem travar.
export const FETCH_CONCURRENCY = Math.max(
  1,
  Math.min(32, Math.floor(Number(process.env.FETCH_CONCURRENCY) || 32))
);

// Busca automática de APIs internas. Aceita 0 (desliga) e qualquer inteiro
// >= 0 (sem teto artificial). Um env não numérico cai no padrão — antes
// virava NaN e a busca desligava em silêncio.
export const API_MAX_CANDIDATES = clampEnvZero(process.env.API_MAX_CANDIDATES, 2, 0, Number.MAX_SAFE_INTEGER);
export const API_TOTAL_BUDGET_MS = Math.max(250, Math.floor(Number(process.env.API_TOTAL_BUDGET_MS) || 1500));

// Controle de admissão HTTP.
export const MAX_INFLIGHT_REQUESTS = clampEnv(process.env.MAX_INFLIGHT_REQUESTS, 128, 1, 100000);
export const MAX_WAITING_REQUESTS = clampEnvZero(process.env.MAX_WAITING_REQUESTS, 4096, 0, 1000000);
export const MAX_WAIT_MS = clampEnv(process.env.MAX_WAIT_MS, 15000, 1, 600000);

export const OUTBOUND_MAX_CONCURRENCY = clampEnv(process.env.OUTBOUND_MAX_CONCURRENCY, 128, 1, 2048);
export const OUTBOUND_MAX_QUEUE = clampEnvZero(process.env.OUTBOUND_MAX_QUEUE, 100, 0, 50000);
export const OUTBOUND_MEMORY_BUDGET = clampEnv(
  process.env.OUTBOUND_MEMORY_BUDGET,
  64 * 1024 * 1024,
  4 * 1024 * 1024,
  512 * 1024 * 1024
);
// Teto de concorrência POR HOST: um site lento não pode consumir todas as
// vagas de download enquanto os outros esperam. O teto global (acima) segue
// valendo por cima; este é a garantia de justiça entre sites. Sem sinal
// explícito na URL, a chave é o host — antes disso, um único host pendurado
// ocupava a fila inteira e os outros sites ficavam atrás dele.
// Calibrado pelo joelho da curva (~64, mesma referência de MAX_INFLIGHT):
// com 32, o harness mediu 52 req/s (host único estrangulado); com 64, os
// mesmos 76 req/s do baseline — e um host no pior caso fica com metade
// das vagas globais, nunca com todas.
export const HOST_MAX_CONCURRENCY = clampEnv(process.env.HOST_MAX_CONCURRENCY, 64, 1, 2048);
export const HOST_MAX_QUEUE = clampEnvZero(process.env.HOST_MAX_QUEUE, 256, 0, 50000);

// Tuning do servidor HTTP (keep-alive, timeouts, conexões).
export const HTTP_REQUEST_TIMEOUT_MS = clampEnv(process.env.HTTP_REQUEST_TIMEOUT_MS, 150000, 500, 300000);
export const HTTP_HEADERS_TIMEOUT_MS = clampEnv(process.env.HTTP_HEADERS_TIMEOUT_MS, 33000, 500, HTTP_REQUEST_TIMEOUT_MS);
export const HTTP_KEEPALIVE_TIMEOUT_MS = clampEnv(process.env.HTTP_KEEPALIVE_TIMEOUT_MS, 32500, 500, HTTP_HEADERS_TIMEOUT_MS);
export const MAX_CONNECTIONS = clampEnvZero(process.env.MAX_CONNECTIONS, 0, 0, 1000000);

// Teto de bytes de UMA linha no transporte stdio (JSON-RPC newline-delimited).
// Linha maior que isto e descartada com Parse error: antes o buffer crescia
// sem limite e uma unica linha gigante consumia a memoria do processo.
export const STDIO_MAX_LINE_BYTES = clampEnv(
  process.env.STDIO_MAX_LINE_BYTES,
  4 * 1024 * 1024,
  64 * 1024,
  64 * 1024 * 1024
);

// Qualidade do brotli na compressão da resposta do /mcp.
// O padrão do Node é 11 — o mais caro que existe e SÍNCRONO (segura o event
// loop). Medido neste projeto, num corpo do tamanho de um tools/list (6,5 KB):
// q11 = 17,3 ms por requisição; q4 = 0,68 ms; gzip = 0,59 ms. A saída em q11
// tem 131 bytes e em q4 tem 145 — 10 bytes a mais por 25x menos CPU. É o
// caminho crítico de toda resposta, então 4 é o padrão; quem quiser o byte a
// menos sobe para 11 por env.
export const BROTLI_QUALITY = clampEnvZero(process.env.BROTLI_QUALITY, 4, 0, 11);

// Teto do cache de compressão (entradas). Guarda a versão comprimida de um
// corpo que se repete — a chave é o sha256 do corpo, então só acerta quando o
// byte a byte é idêntico (ex.: o mesmo tools/list reenviado). 0 desliga.
export const COMPRESSAO_CACHE_ENTRIES = clampEnvZero(process.env.COMPRESSAO_CACHE_ENTRIES, 64, 0, 4096);

// Cache em memória (LRU + TTL).
export const CACHE_TTL_MS = Math.max(500, Math.floor(Number(process.env.CACHE_TTL_MS) || 7.5 * 60 * 1000));
// Teto de entradas ajustável: com muitos sites distintos no ar, 100 entradas
// evicta páginas ainda quentes. Subir aqui aumenta o reuso sem tocar em código.
export const CACHE_MAX_ENTRIES = clampEnv(process.env.CACHE_MAX_ENTRIES, 100, 1, 100000);
export const CACHE_MAX_BYTES = Math.max(512, Math.floor(Number(process.env.CACHE_MAX_BYTES) || 32 * 1024 * 1024));
export const CACHE_MAX_ENTRY_BYTES = Math.min(
  Math.floor(CACHE_MAX_BYTES / 4),
  Math.floor(MAX_RESPONSE_BYTES / 2)
);

// Revalidação em segundo plano (stale-while-revalidate). Desligada por padrão:
// expirada = busca de novo (o comportamento que a suíte trava). Com CACHE_SWR=1,
// entrada vencida dentro da janela de graça é servida na hora e atualizada atrás
// — quem chega no vencimento não espera download nenhum.
export const CACHE_SWR = process.env.CACHE_SWR === "1";
// Janela de graça do SWR em ms. 0 = padrão do cache (2× o TTL).
export const CACHE_STALE_WINDOW_MS = clampEnvZero(
  process.env.CACHE_STALE_WINDOW_MS,
  0,
  0,
  Number.MAX_SAFE_INTEGER
);

// Memoização da conversão (HTML -> markdown/meta/links) por conteúdo baixado.
// Ligada por padrão; MEMO_CONVERSAO=0 desliga (depurar o parser sem memo).
export const MEMO_CONVERSAO = process.env.MEMO_CONVERSAO !== "0";

// Cache de validação de host (SSRF).
export const HOST_CHECK_TTL_MS = 5 * 60 * 1000;
export const HOST_CHECK_MAX_ENTRIES = 500;
// Teto do getaddrinfo (DNS) da validação SSRF. Sem ele, um resolver que não
// responde (visto no Render: 128 vagas de admissão presas por >100 min) deixa
// a promessa pendurada para sempre e a vaga nunca volta. É teto de espera, não
// de download: o lookup em si não é cancelável, mas quem espera desiste.
export const DNS_TIMEOUT_MS = clampEnv(process.env.DNS_TIMEOUT_MS, 5000, 500, 30000);

// Cache de agents HTTP (keep-alive por IP).
export const AGENT_CACHE_MAX = 256;

// Teto de redirects seguidos (configurável por MAX_REDIRECTS).
export const MAX_REDIRECTS = clampEnv(process.env.MAX_REDIRECTS, 5, 1, 10);

// Teto do Retry-After (10 s).
export const RETRY_AFTER_MAX_MS = 10000;

// Cache de robots.txt.
export const ROBOTS_RESPECT = process.env.ROBOTS_RESPECT !== "0";
export const ROBOTS_TTL_MS = Math.max(500, Math.floor(Number(process.env.ROBOTS_TTL_MS) || 15 * 60 * 1000));
export const ROBOTS_TIMEOUT_MS = Math.max(500, Math.min(15000, Math.floor(Number(process.env.ROBOTS_TIMEOUT_MS) || 2500)));
export const ROBOTS_NEGATIVE_TTL_MS = 60000;
export const ROBOTS_MAX_BYTES = 512 * 1024;
export const ROBOTS_MAX_ORIGINS = 1000;
// Teto de concorrencia das buscas de robots.txt (uma por origem). Sem ele,
// uma rajada em muitas origens novas dispararia N buscas ao mesmo tempo.
export const ROBOTS_MAX_CONCURRENCY = clampEnv(process.env.ROBOTS_MAX_CONCURRENCY, 16, 1, 256);

// Teto de saída somada em read_multiple_pages.
export const MULTI_MAX_TOTAL_CHARS = Math.max(
  2000,
  Math.floor(Number(process.env.MULTI_MAX_TOTAL_CHARS) || 10 * HARD_MAX_CHARS)
);

// Permite hosts privados (apenas desenvolvimento/testes).
export const ALLOW_PRIVATE_HOSTS = process.env.ALLOW_PRIVATE_HOSTS === "1";

/**
 * Clampa um valor de ambiente entre min e max.
 */
export function clampEnv(valor, padrao, min, max) {
  const n = Math.floor(Number(valor));
  if (!Number.isFinite(n) || n <= 0) return padrao;
  return Math.max(min, Math.min(max, n));
}

/**
 * Como clampEnv, mas aceita 0 (ex.: "sem fila", "sem teto de conexões").
 */
export function clampEnvZero(valor, padrao, min, max) {
  if (valor === undefined || valor === null || valor === "") return padrao;
  const n = Math.floor(Number(valor));
  if (!Number.isFinite(n) || n < 0) return padrao;
  return Math.max(min, Math.min(max, n));
}
