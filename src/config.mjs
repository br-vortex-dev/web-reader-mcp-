/**
 * config.mjs — todos os números e limites do projeto, num lugar só.
 *
 * O QUE É
 *   Cada teto, timeout, tamanho máximo e valor padrão do servidor vive aqui,
 *   em constante nomeada. A pergunta "quantos caracteres o read_page devolve
 *   no máximo?" tem UMA resposta, e ela está neste arquivo — não espalhada em
 *   número solto pelo resto do código.
 *
 * O QUE ENTRA / O QUE SAI
 *   Entra: nada. O módulo lê o ambiente (process.env) uma vez, ao ser
 *          carregado, e é isso.
 *   Sai:   as constantes já calculadas e validadas — cada uma passa por um
 *          clamp (nunca zero, nunca absurdo) para que um valor errado de
 *          ambiente não derrube o servidor.
 *
 * QUEM USA
 *   Usado por: fetch, http-transport, net, pdf, security, server, tools, video.
 */

export const SERVER_NAME = "web-reader";
export const SERVER_VERSION = "1.9.8";

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
  "2025-11-25",
]);

// Timeout padrão de cada requisição HTTP (configurável por DEFAULT_TIMEOUT_MS).
export const DEFAULT_TIMEOUT_MS = clampEnv(process.env.DEFAULT_TIMEOUT_MS, 8000, 1000, 60000);

// Tetos de saída de texto.
export const HARD_MAX_CHARS = 25000;
export const DEFAULT_MAX_CHARS = clampEnv(process.env.DEFAULT_MAX_CHARS, 8000, 200, HARD_MAX_CHARS);

// Teto de páginas por chamada em read_multiple_pages e crawl_site.
export const MAX_PAGES_PER_CALL = 30;

// PRAZO FINAL das ferramentas de VÁRIAS páginas (read_multiple_pages e
// crawl_site).
//
// O problema que isto resolve: a resposta só saía quando a última página
// terminasse. Numa lista de 30, uma página lenta segurava as 29 prontas, e
// como o cliente MCP desiste no próprio teto de tempo, o pior caso era perder
// TUDO o que já estava lido.
//
// O prazo é o timeout de UMA leitura (o que o cliente pediu), com um piso
// para listas curtas não serem cortadas cedo demais e um teto duro para a
// chamada não passar de dois minutos em nenhuma hipótese. Estourou: devolve o
// que já leu, avisa quantas faltaram, e o trabalho em voo segue aquecendo o
// cache — a chamada seguinte acha pronto.
export const MAX_PRAZO_MULTI_MS = clampEnv(
  process.env.MAX_PRAZO_MULTI_MS,
  60000,
  5000,
  120000
);
export const PRAZO_MINIMO_MULTI_MS = clampEnv(
  process.env.PRAZO_MINIMO_MULTI_MS,
  15000,
  1000,
  120000
);

// Teto de download por requisição.
export const MAX_RESPONSE_BYTES = Math.max(
  64 * 1024,
  Math.floor(Number(process.env.MAX_RESPONSE_BYTES) || 5 * 1024 * 1024)
);

// Teto de download das ferramentas que precisam do DOCUMENTO INTEIRO para
// funcionar: extract_links, find_on_page e diff_page.
//
// Por que não MAX_RESPONSE_BYTES: nessas três, cortar destrói o resultado —
// os links moram no rodapé e o termo buscado pode estar em qualquer lugar.
// Só que a alternativa que existia era pior: acima de 5 MB a chamada FALHAVA
// inteira. Medido em dev/load/bateria-limite.json: em
// nodejs.org/api/all.html (~8 MB) o read_page respondia em 1.487 ms e o
// extract_links devolvia "Resposta muito grande" — na MESMA URL. Devolver 200
// links de um documento parcial é melhor que devolver zero links.
//
// Por isso este teto é maior, e o corte acima dele é SINALIZADO na saída (e,
// como todo corte, não entra no cache). 24 MB cobre com folga a documentação
// densa real (whatwg 12 MB, nodejs 8 MB) sem abrir a porta para um arquivo
// absurdo consumir memória: acima disso a chamada responde parcial e avisa.
export const MAX_RESPONSE_BYTES_DOCUMENTO = Math.max(
  MAX_RESPONSE_BYTES,
  Math.floor(Number(process.env.MAX_RESPONSE_BYTES_DOCUMENTO) || 24 * 1024 * 1024)
);

// Teto de download PROPORCIONAL ao texto pedido (só nas ferramentas de UMA
// página cujo objetivo é TEXTO: read_page e read_dynamic_page).
//
// O problema que isto resolve: antes, toda leitura baixava até
// MAX_RESPONSE_BYTES (5 MB) mesmo quando a pessoa pediu 2.000 caracteres —
// o whatwg (12 MB) e o washingtonpost gastavam a maior parte do tempo
// baixando marcação que seria jogada 99% fora. Medido em dev/_bateria-*:
// era o único gargalo de CPU/rede que sobrava no caminho de leitura.
//
// A folga de 60x existe porque HTML tem muita marcação em volta do texto
// (script, style, atributos, navegação). O piso de 1 MB protege as páginas
// comuns: a esmagadora maioria dos sites tem menos que isso, então o teto
// só entra em ação nas páginas gigantes — exatamente onde o desperdício
// estava. O corte é SINALIZADO no resultado e NÃO entra no cache (HTML
// truncado envenenaria toda leitura futura da mesma URL).
//
// Ferramenta que precisa do HTML INTEIRO para funcionar NÃO usa este teto:
// extract_links, discover_urls, find_on_page e diff_page (que cortariam
// links e o termo buscado), e também read_multiple_pages e crawl_site — no
// crawl os links moram no rodapé, e medir mostrou que o corte ali fazia o
// texto entregue sair menor. Ver a seção "Download proporcional ao texto
// pedido" no README.
export const DOWNLOAD_FOLGA_POR_CHAR = clampEnv(
  process.env.DOWNLOAD_FOLGA_POR_CHAR,
  60,
  1,
  1000
);
// Piso do teto proporcional. Quando ele ENCOSTA no teto duro, o teto deixa de
// ser proporcional (toda leitura baixa até o máximo) — é assim que a bateria
// desliga o recurso para medir o comportamento antigo.
// NÃO é 1 MB: com piso de 1 MB e folga de 60x, todo
// `maxChars` abaixo de ~17.000 caía no piso e o teto deixava de ser
// proporcional — o washingtonpost (3,7 MB) era cortado em 1 MB, tinha de ser
// relido inteiro, e ficava 50% mais LENTO que sem o recurso. O piso existe só
// para páginas pequenas não virarem download minúsculo; 256 KB cumpre isso.
export const DOWNLOAD_MIN_BYTES = Math.min(
  MAX_RESPONSE_BYTES,
  Math.max(64 * 1024, Math.floor(Number(process.env.DOWNLOAD_MIN_BYTES) || 256 * 1024))
);

/** O teto proporcional está ativo? (piso abaixo do teto duro) */
export const DOWNLOAD_PROPORCIONAL_ATIVO = DOWNLOAD_MIN_BYTES < MAX_RESPONSE_BYTES;

/**
 * Teto de download para uma leitura que busca `maxChars` caracteres de texto.
 * Nunca passa do teto duro (MAX_RESPONSE_BYTES): acima dele o erro continua.
 */
export function tetoDownloadPara(maxChars, tetoDuro = MAX_RESPONSE_BYTES) {
  // Desligado: devolve o teto duro, e o caminho do código que depende de
  // "existe um teto maior para refazer" se desarma sozinho (corte e retry só
  // acontecem quando apertado < largo).
  if (!DOWNLOAD_PROPORCIONAL_ATIVO) return tetoDuro;
  const pedido = Math.max(200, Math.floor(Number(maxChars) || DEFAULT_MAX_CHARS));
  const proporcional = pedido * DOWNLOAD_FOLGA_POR_CHAR;
  return Math.min(tetoDuro, Math.max(DOWNLOAD_MIN_BYTES, proporcional));
}

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
// Teto de entradas ajustável: com muitos sites distintos no ar, poucas entradas
// evictam páginas ainda quentes. 512 cobre com folga o conjunto de trabalho de
// um servidor que lê dezenas de sites por hora, sem custo quando o tráfego é
// pequeno (o cache só ocupa o que de fato foi baixado).
export const CACHE_MAX_ENTRIES = clampEnv(process.env.CACHE_MAX_ENTRIES, 512, 1, 100000);
// 128 MB: o valor anterior (32 MB) enchia no próprio teste de carga — foram
// medidos 52 entradas ocupando 33 MB, ou seja, o cache despejava página quente
// enquanto ainda servia. Memória é barata perto de um download a menos.
export const CACHE_MAX_BYTES = Math.max(512, Math.floor(Number(process.env.CACHE_MAX_BYTES) || 128 * 1024 * 1024));
// Teto de UMA entrada. Antes era metade do download máximo (2,5 MB com o
// padrão de 5 MB), então página grande NUNCA entrava no cache: era baixada,
// convertida e descartada a cada leitura. Agora o teto acompanha o teto de
// download, e a página inteira cabe.
export const CACHE_MAX_ENTRY_BYTES = Math.min(
  Math.floor(CACHE_MAX_BYTES / 4),
  MAX_RESPONSE_BYTES
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

// Cache NEGATIVO: respostas HTTP que não vão mudar tão cedo (404, 410, 401,
// 403...) ficam lembradas por um tempo curto, para não pagar a mesma conexão
// de novo a cada chamada. Sem ele, uma URL que responde 404 custava o
// download inteiro toda vez que alguém a pedia.
//
// Só entra status PERMANENTE. 429 e 5xx ficam fora de propósito: são falhas
// passageiras, e o retry já cuida delas — guardá-las transformaria um tropeço
// momentâneo em erro fixo por minutos. O TTL é curto porque um 404 de hoje
// pode virar 200 amanhã (publicação, deploy, correção do site).
export const CACHE_NEGATIVO_TTL_MS = Math.max(
  1000,
  Math.floor(Number(process.env.CACHE_NEGATIVO_TTL_MS) || 2 * 60 * 1000)
);
// 0 desliga o recurso (é assim que a bateria mede o comportamento antigo).
export const CACHE_NEGATIVO_MAX_ENTRIES = clampEnvZero(
  process.env.CACHE_NEGATIVO_MAX_ENTRIES,
  256,
  0,
  10000
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
// Cache da INACESSIBILIDADE (404/timeout no robots.txt). Subiu de 60s para
// 15 min: um host sem robots.txt é o caso mais comum da web, e com 60s um site
// movimentado repunha essa ida à rede toda hora. Robots inacessível é estável
// — se o dono publicar um depois, a próxima janela pega.
export const ROBOTS_NEGATIVE_TTL_MS = Math.max(60000, Math.floor(Number(process.env.ROBOTS_NEGATIVE_TTL_MS) || ROBOTS_TTL_MS));
export const ROBOTS_MAX_BYTES = 512 * 1024;
export const ROBOTS_MAX_ORIGINS = 1000;
// Teto de regras guardadas por origem. Todo acesso a uma URL varre a lista; um
// robots.txt grande e hostil com milhares de Disallow faria cada leitura pagar
// a varredura inteira. Acima do teto, as regras seguintes são ignoradas (falha
// para o lado permitido, como o fail-open do resto do arquivo).
export const ROBOTS_MAX_REGRAS = 2000;
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

// Persistência das marcas do diff_page. Vazio = só em memória, e a primeira
// leitura depois de um reinício volta a ser "PRIMEIRA leitura". Com SNAPSHOT_DIR
// (ex.: /data/web-reader-mcp) as marcas vão para disco e sobrevivem ao restart e
// aos workers do WEB_CONCURRENCY. Em host com disco efémero (Render free tier)
// um redeploy ainda limpa o diretório — isso é do ambiente, não do código.
export const SNAPSHOT_DIR = String(process.env.SNAPSHOT_DIR || "").trim();
export const SNAPSHOT_TTL_MS = Math.max(
  60000,
  Math.floor(Number(process.env.SNAPSHOT_TTL_MS) || 6 * 60 * 60 * 1000)
);
export const SNAPSHOT_MAX_ENTRIES = clampEnv(process.env.SNAPSHOT_MAX_ENTRIES, 500, 1, 100000);
export const SNAPSHOT_MAX_BYTES = Math.max(
  65536,
  Math.floor(Number(process.env.SNAPSHOT_MAX_BYTES) || 8 * 1024 * 1024)
);

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
