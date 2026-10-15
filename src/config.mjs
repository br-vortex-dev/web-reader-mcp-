/**
 * Configuração central do web-reader-mcp.
 * Todos os tetos, timeouts e defaults do servidor ficam aqui.
 */

export const SERVER_NAME = "web-reader";
export const SERVER_VERSION = "1.1.0";

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

// Timeout padrão de cada requisição HTTP.
export const DEFAULT_TIMEOUT_MS = 1500;

// Tetos de saída de texto.
export const DEFAULT_MAX_CHARS = 4000;
export const HARD_MAX_CHARS = 25000;

// Teto de páginas por chamada em read_multiple_pages e crawl_site.
export const MAX_PAGES_PER_CALL = 15;

// Teto de download por requisição.
export const MAX_RESPONSE_BYTES = Math.max(
  64 * 1024,
  Math.floor(Number(process.env.MAX_RESPONSE_BYTES) || 5 * 1024 * 1024)
);

// Concorrência de downloads (sockets/tarefas simultâneas).
// 32 permite que read_multiple_pages e crawl_token processem lotes maiores sem travar.
export const FETCH_CONCURRENCY = Math.max(
  1,
  Math.min(32, Math.floor(Number(process.env.FETCH_CONCURRENCY) || 32))
);

// Busca automática de APIs internas.
export const API_MAX_CANDIDATES = Math.max(0, Math.floor(Number(process.env.API_MAX_CANDIDATES || 2)));
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
  2 * 1024 * 1024,
  512 * 1024 * 1024
);

// Tuning do servidor HTTP (keep-alive, timeouts, conexões).
export const HTTP_REQUEST_TIMEOUT_MS = clampEnv(process.env.HTTP_REQUEST_TIMEOUT_MS, 150000, 500, 300000);
export const HTTP_HEADERS_TIMEOUT_MS = clampEnv(process.env.HTTP_HEADERS_TIMEOUT_MS, 33000, 500, HTTP_REQUEST_TIMEOUT_MS);
export const HTTP_KEEPALIVE_TIMEOUT_MS = clampEnv(process.env.HTTP_KEEPALIVE_TIMEOUT_MS, 32500, 500, HTTP_HEADERS_TIMEOUT_MS);
export const MAX_CONNECTIONS = clampEnvZero(process.env.MAX_CONNECTIONS, 0, 0, 1000000);

// Cache em memória (LRU + TTL).
export const CACHE_TTL_MS = Math.max(500, Math.floor(Number(process.env.CACHE_TTL_MS) || 7.5 * 60 * 1000));
export const CACHE_MAX_ENTRIES = 100;
export const CACHE_MAX_BYTES = Math.max(512, Math.floor(Number(process.env.CACHE_MAX_BYTES) || 32 * 1024 * 1024));
export const CACHE_MAX_ENTRY_BYTES = Math.min(
  Math.floor(CACHE_MAX_BYTES / 4),
  Math.floor(MAX_RESPONSE_BYTES / 2)
);

// Cache de validação de host (SSRF).
export const HOST_CHECK_TTL_MS = 5 * 60 * 1000;
export const HOST_CHECK_MAX_ENTRIES = 500;

// Cache de agents HTTP (keep-alive por IP).
export const AGENT_CACHE_MAX = 256;

// Teto de redirects seguidos.
export const MAX_REDIRECTS = 3;

// Teto do Retry-After (5 s).
export const RETRY_AFTER_MAX_MS = 5000;

// Cache de robots.txt.
export const ROBOTS_RESPECT = process.env.ROBOTS_RESPECT !== "0";
export const ROBOTS_TTL_MS = Math.max(500, Math.floor(Number(process.env.ROBOTS_TTL_MS) || 15 * 60 * 1000));
export const ROBOTS_TIMEOUT_MS = Math.max(500, Math.min(15000, Math.floor(Number(process.env.ROBOTS_TIMEOUT_MS) || 2500)));
export const ROBOTS_NEGATIVE_TTL_MS = 60000;
export const ROBOTS_MAX_BYTES = 512 * 1024;
export const ROBOTS_MAX_ORIGINS = 1000;

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
function clampEnv(valor, padrao, min, max) {
  const n = Math.floor(Number(valor));
  if (!Number.isFinite(n) || n <= 0) return padrao;
  return Math.max(min, Math.min(max, n));
}

/**
 * Como clampEnv, mas aceita 0 (ex.: "sem fila", "sem teto de conexões").
 */
function clampEnvZero(valor, padrao, min, max) {
  if (valor === undefined || valor === null || valor === "") return padrao;
  const n = Math.floor(Number(valor));
  if (!Number.isFinite(n) || n < 0) return padrao;
  return Math.max(min, Math.min(max, n));
}
