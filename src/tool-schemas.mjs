/**
 * Schemas JSON das ferramentas expostas ao cliente MCP (tools/list).
 * Separado do roteador para manter server.mjs enxuto.
 */

// Definição das ferramentas (schema JSON).
export const TOOLS = [
  {
    name: "read_page",
    description:
      "Lê uma página web (GET) e devolve o conteúdo extraído em markdown: título, meta descrição e texto principal. " +
      "Use para ler artigos, documentações, blogs, páginas de produto, etc.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL completa (http/https) da página a ler" },
        maxChars: {
          type: "number",
          description: "Máximo de caracteres do conteúdo retornado (padrão 8000, max 25000)",
        },
        timeoutMs: { type: "number", description: "Timeout da requisição em ms (padrão 8000)" },
      },
      required: ["url"],
    },
  },
  {
    name: "extract_links",
    description:
      "Acessa uma página e lista seus links (texto + URL absoluta), sem duplicatas. " +
      "Use para descobrir para onde uma página aponta e escolher a próxima página a ler.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL da página" },
        limit: { type: "number", description: "Quantidade máxima de links a listar (padrão 50, max 200)" },
        timeoutMs: { type: "number", description: "Timeout da requisição em ms (padrão 8000)" },
      },
      required: ["url"],
    },
  },
  {
    name: "read_multiple_pages",
    description:
      "Lê várias páginas por chamada (máx 30 URLs, em lotes paralelos) e devolve o conteúdo de cada uma, " +
      "com o status de sucesso/falha por URL.",
    inputSchema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description: "Lista de URLs (http/https), máximo 30",
        },
        maxChars: {
          type: "number",
          description: "Máximo de caracteres por página (padrão 8000)",
        },
        timeoutMs: { type: "number", description: "Timeout por requisição em ms (padrão 8000)" },
      },
      required: ["urls"],
    },
  },
  {
    name: "discover_urls",
    description:
      "Descobre as URLs de um site: lê o sitemap.xml (e variantes, incluindo sitemap indexes) " +
      "e lista as páginas encontradas. Se não houver sitemap, devolve os links internos da home. " +
      "Use para saber o que dá para ler num site antes de chamar read_multiple_pages.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL do site (ex.: https://exemplo.com)" },
        limit: { type: "number", description: "Quantidade máxima de URLs a listar (padrão 100, max 300)" },
        timeoutMs: { type: "number", description: "Timeout por requisição em ms (padrão 8000)" },
      },
      required: ["url"],
    },
  },
  {
    name: "crawl_site",
    description:
      "Lê um site sozinho: começa na URL, extrai os links internos e vai seguindo pelos não visitados " +
      "(BFS, lotes paralelos), devolvendo o conteúdo de cada página. " +
      "Ideal para varrer um blog, documentação ou seção de notícias sem a IA ter que pedir URL por URL. " +
      "Máximo de 30 páginas por chamada.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL inicial (página ou home do site)" },
        maxPages: { type: "number", description: "Máximo de páginas a ler (padrão 10, max 30)" },
        maxChars: { type: "number", description: "Máximo de caracteres por página (padrão 2000)" },
        timeoutMs: { type: "number", description: "Timeout por requisição em ms (padrão 8000)" },
      },
      required: ["url"],
    },
  },
  {
    name: "read_dynamic_page",
    description:
      "Lê páginas que dependem de JavaScript para renderizar (React, Vue, Angular, Next.js, etc.) " +
      "sem precisar de Playwright. Detecta se a página é dinâmica e extrai dados embutidos no HTML " +
      "(__NEXT_DATA__, __NUXT__, __INITIAL_STATE__, JSON-LD, APIs internas). " +
      "Use quando read_page retornar conteúdo vazio ou muito curto em sites modernos.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL completa (http/https) da página a ler" },
        maxChars: {
          type: "number",
          description: "Máximo de caracteres do conteúdo retornado (padrão 8000, max 25000)",
        },
        timeoutMs: { type: "number", description: "Timeout da requisição em ms (padrão 8000)" },
      },
      required: ["url"],
    },
  },
  {
    name: "read_video",
    description:
      "Lê um vídeo de plataformas conhecidas (YouTube, Vimeo) ou de qualquer página com vídeo embutido: " +
      "devolve os metadados publicados (título, canal, duração, visualizações, descrição, capa) e a " +
      "TRANSCRIÇÃO da legenda, com timestamps, quando a plataforma publica legenda acessível. " +
      "Aceita também link direto de legenda (.vtt/.srt). Não baixa o vídeo nem gera quadros — " +
      "só o que existe como texto acessível. Para YouTube, se as legendas estiverem bloqueadas " +
      "para acesso anônimo, devolve os metadados com o motivo explícito no campo Transcricao.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL do vídeo (YouTube, Vimeo), de página com vídeo, ou link direto .vtt/.srt",
        },
        maxChars: {
          type: "number",
          description: "Máximo de caracteres da saída (padrão 8000, max 25000)",
        },
        lang: {
          type: "string",
          description: "Idioma preferido da legenda (ex.: pt, pt-BR, en). Sem ele, tenta pt-BR, pt, en",
        },
        timeoutMs: { type: "number", description: "Timeout da requisição em ms (padrão 8000)" },
      },
      required: ["url"],
    },
  },
  {
    name: "read_pdf",
    description:
      "Lê um PDF público e devolve o TEXTO extraído (sem OCR): artigos, editais, relatórios, contratos. " +
      "Reconstrói espaços e quebras a partir dos operadores de texto do PDF. " +
      "Não lê PDF escaneado (só imagem) — nesse caso devolve o motivo explícito. " +
      "Use quando a URL terminar em .pdf ou o read_page recusar por não ser HTML.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL completa (http/https) do PDF" },
        maxChars: {
          type: "number",
          description: "Máximo de caracteres do conteúdo retornado (padrão 8000, max 25000)",
        },
        timeoutMs: { type: "number", description: "Timeout da requisição em ms (padrão 8000)" },
      },
      required: ["url"],
    },
  },
  {
    name: "read_feed",
    description:
      "Lê um feed RSS 2.0, RDF, Atom ou JSON Feed e devolve os itens em markdown: título, link, " +
      "data, autor e resumo de cada um. Use para acompanhar blog, notícia, changelog ou releases " +
      "sem varrer link por link. Não segue os links dos itens — para o texto completo, chame read_page.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL do feed (http/https), normalmente .xml, .rss, feed ou atom.xml" },
        limit: { type: "number", description: "Quantidade máxima de itens a listar (padrão 20, max 100)" },
        maxChars: {
          type: "number",
          description: "Máximo de caracteres da saída (padrão 8000, max 25000)",
        },
        timeoutMs: { type: "number", description: "Timeout da requisição em ms (padrão 8000)" },
      },
      required: ["url"],
    },
  },
  {
    name: "read_json",
    description:
      "Lê uma resposta JSON pública (API, endpoint .json) e devolve o JSON formatado, com a forma " +
      "declarada (objeto/array e chaves). Aceita 'path' (ex.: 'data.items') para entregar só o ramo " +
      "que interessa. Use quando a URL for de API em vez de usar read_page, que é só-HTML.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL completa (http/https) que devolve JSON" },
        path: {
          type: "string",
          description: "Caminho dentro do JSON, separado por ponto (ex.: 'data.items'). Sem ele, devolve a raiz",
        },
        maxChars: {
          type: "number",
          description: "Máximo de caracteres da saída (padrão 8000, max 25000)",
        },
        timeoutMs: { type: "number", description: "Timeout da requisição em ms (padrão 8000)" },
      },
      required: ["url"],
    },
  },
];
