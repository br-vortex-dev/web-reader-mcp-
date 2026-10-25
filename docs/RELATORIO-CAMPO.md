# RELATÓRIO DE CAMPO — web-reader-mcp na web real

> Teste de campo executado em 14/10/2026. **Nenhuma linha de código do produto foi alterada.** Esta rodada é só de teste e relatório.

## Metodologia

- O `server.js` real foi levantado localmente em modo HTTP (porta 8899) e chamado por JSON-RPC em `/mcp`, como uma IA faria — sem SDK, sem mocks, web pública de verdade.
- 63 casos na bateria principal (`campo/driver.mjs`) + 7 casos extras fechando lacunas (`campo/extras.mjs`), num total de **70 testes**.
- Bom cidadão: pausa de 1,5 s entre chamadas (2,5 s no mesmo host), no máximo 2–3 pedidos por site, User-Agent normal, nenhuma tentativa de furar paywall/login/captcha/Cloudflare, nenhuma credencial ou cookie.
- `ALLOW_PRIVATE_HOSTS` nunca foi ativado (descartado do ambiente antes de subir o servidor). Os testes de segurança da categoria H usam só serviços públicos de teste (httpbin, badssl).
- Desvio de configuração documentado: a instância local da bateria rodou com `RATE_LIMIT_MAX=1000000` para a própria bateria (~70 chamadas) não ser travada pelo limite de 60/min. O limite padrão foi verificado à parte, numa segunda instância: **primeira resposta 429 na chamada 61 (5 de 65)** — `campo/ratelimit.json`.
- Saídas brutas salvas em `campo/raw/` (um arquivo por caso, com o JSON-RPC completo e o texto extraído). Métricas em `campo/resultados.json` e `campo/extras.json`.
- Trocas de URL (originais mortas ou bloqueadas) registradas na tabela e na seção 6.

<!-- SECAO2 -->

## 1. Resumo executivo

**Nota geral: 7,5/10.** O servidor cumpre a promessa central — ler a web pública com fidelidade — na grande maioria dos casos que importam: documentação técnica, código, portais de notícia, encodings e segurança. Mas três defeitos de fabrica apareceram na web real e estragam exatamente os conteúdos mais "máquina" da internet: texto puro, XML e páginas dinâmicas com SSR rico.

**Os 3 piores problemas:**

1. **BUG-1 (alto) — texto puro e XML perdem todas as quebras de linha.** `robots.txt` sai como uma linha única (inutilizável — robots.txt é um formato linha-a-linha), sitemaps saem com as URLs coladas umas nas outras, e arquivos raw (`.md`, `.json` no raw.githubusercontent.com) saem em linha única. É o `server.js:602` colapsando `\s+` em espaço em qualquer texto fora de `<pre>`. Em HTML isso é correto; em texto puro e XML, que não têm tags de bloco, destrói o arquivo.
2. **BUG-3 (alto) — `read_dynamic_page` degrada página boa.** Em `react.dev/learn` (SSR completo, 17.465 caracteres extraídos pelo `read_page`), a ferramenta dinâmica viu a marca `__NEXT_DATA__`, substituiu o markdown bom por um despejo de JSON escapado e entregou 5.323 caracteres de `{"className":...}` — 4 cercas de código onde o `read_page` tinha 18. Piora consciente do conteúdo.
3. **BUG-5 + BUG-4 (médio/alto) — falhas que não parecem falhas, e falhas que não dizem o porquê.** SPA carregada por API devolve `Conteudo: 0 caracteres` com cara de sucesso (hn.algolia.com, bcb.gov.br), e certificado SSL inválido devolve 18 caracteres de `Erro: fetch failed`, sem o `cause` do Node (`SELF_SIGNED_CERT_IN_CHAIN`, `CERT_HAS_EXPIRED`) que diria o que aconteceu.

**O que funciona muito bem:** docs/código (MDN pt-BR, Python, arXiv, CERN 1992), encodings sem uma única ocorrência de mojibake em 70 casos (japonês, chinês, árabe, hebraico, emoji, ISO-8859-1 do IPEA), segurança SSRF (5/5 bloqueios com endereço exato na mensagem; redirect público para interno barrado no salto), rate limit, cache (36× mais rápido na 2ª leitura), ferramentas compostas (isolamento por URL no `read_multiple_pages`, crawl contra host bloqueado devolve erro, não "0 páginas").

**O que não funciona:** sites que fecham a porta para robôs — Stack Overflow, npmjs, IBGE e w3c devolvem 403. Foram respeitados (não burlados, como manda a regra), mas a cobertura real do produto para na porta desses sites. PDF seguiu sem teste: a URL original morreu e a substituta deu 403.

<!-- SECAO3 -->

## 2. Tabela por teste (70 casos)

Situação: **ok** = entregou o conteúdo; **parcial** = entregou com perda material de qualidade; **falhou** = erro ou conteúdo inutilizável. `falhou*` = rejeição limpa e correta (não é o que a ferramenta deveria ler). Nota 0–10 de utilidade para a IA que consome a saída. `T` = truncado no `maxChars`Pedido.

| # | Cat | URL (encurtada) | Ferramenta | Situação | Nota | Observação |
|---|-----|-----------------|------------|----------|------|------------|
| 1 | A | developer.mozilla.org/…/Array/filter (pt-BR) | read_page | ok | 9,5 | código, tabela e acentos íntegros; ruído de nav |
| 2 | A | docs.python.org/3/tutorial/classes.html | read_page | ok | 9,5 | prosa, cabeçalhos e links intactos; âncoras `¶` |
| 3 | A | github.com/br-vortex-dev/web-reader-mcp- | read_page | parcial | 7,5 | README completo; coluna "Name" duplicada na lista de arquivos; alerta de sessão |
| 4 | A | raw.githubusercontent.com/…/README.md | read_page | falhou | 3 | **todas as quebras de linha perdidas** (BUG-1) |
| 5 | A | github.com/…/blob/main/package.json | read_page | parcial | 7 | código legível, mas com números de linha 1–17 e chrome duplicado |
| 6 | A | raw.githubusercontent.com/…/package.json | read_page | falhou | 2 | **JSON em linha única** (BUG-1) |
| 7 | A | stackoverflow.com/questions/11227809 | read_page | falhou | 2 | 403 do próprio site; erro claro, conteúdo inacessível |
| 8 | A | pt.wikipedia.org/wiki/Equação_quadrática | read_page | parcial | 6,5 | fórmula como LaTeX-texto + imagem SVG; ambox vira tabela de 1 célula |
| 9 | A | arxiv.org/abs/1706.03762 | read_page | ok | 9,5 | abstract, autores e histórico de versões completos |
| 10 | B | nextjs.org/docs | read_page | ok | 9,5 | SSR completo em 3.345 caracteres |
| 11 | B | nextjs.org/docs | read_dynamic_page | ok | 9,5 | detecta estática e avisa; 25 ms (cache) |
| 12 | B | react.dev/learn | read_page | parcial | 7 | **código duplicado**: uma cópia explodida e uma limpa |
| 13 | B | react.dev/learn | read_dynamic_page | falhou | 3 | **degenera p/ JSON escapado**; 4 cercas vs 18 (BUG-3) |
| 14 | B | vuejs.org/guide/introduction.html | read_page | ok | 9 | docs completas |
| 15 | B | vuejs.org/guide/introduction.html | read_dynamic_page | ok | 9 | mesma qualidade, aviso "página estática" |
| 16 | B | npmjs.com/package/express | read_page | falhou | 2 | 403 do npmjs; erro claro |
| 17 | B | npmjs.com/package/express | read_dynamic_page | falhou | 2 | 403 idem |
| 18 | B | hn.algolia.com/?query=javascript | read_page | falhou | 3 | **0 caracteres, sem aviso de que depende de JS** (BUG-5) |
| 19 | B | old.reddit.com/r/programming | read_page | falhou | 3 | redireciona para login; 0 chars, sem aviso |
| 20 | C | uol.com.br | read_page | ok | 7,5 | manchetes e links; nav com utm antes do conteúdo; `[` órfãos |
| 21 | C | bbc.com/news | read_page | ok | 8 | manchetes + resumos; alt texts gigantes poluem |
| 22 | C | wordpress.org/news | read_page | parcial | 6 | **"Latest Posts" some**: só traços; "People" OK |
| 23 | C | www1.folha.uol.com.br/mercado | read_page | ok | 7 | paywall respeitado; manchetes OK; nav antes do conteúdo |
| 24 | D | pt.wikipedia.org/wiki/Japão | read_page | ok | 9 | infobox + CJK + 104 links |
| 25 | D | pt.wikipedia.org/wiki/Tabela_periódica | read_page | parcial | 6,5 | grade é imagem SVG; tabelas além da janela de 9k |
| 26 | D | ibge.gov.br/cidades-e-estados/sp/sao-paulo | read_page | falhou | 2 | 403 do IBGE; erro claro |

<!-- SECAO3B -->

| # | Cat | URL (encurtada) | Ferramenta | Situação | Nota | Observação |
|---|-----|-----------------|------------|----------|------|------------|
| 27 | E | bcb.gov.br | read_page | falhou | 3 | casca de SPA (0 chars); teste de encoding inconclusivo |
| 28 | E | ja.wikipedia.org/wiki/日本 | read_page | ok | 9,5 | CJK perfeito, zero mojibake |
| 29 | E | zh.wikipedia.org/wiki/Linux | read_page | ok | 9,5 | chinês perfeito |
| 30 | E | ar.wikipedia.org/wiki/رياضيات | read_page | ok | 9,5 | RTL perfeito, texto íntegro |
| 31 | E | he.wikipedia.org/wiki/מתמטיקה | read_page | ok | 9,5 | hebraico perfeito |
| 32 | E | unicode.org/emoji/charts/full-emoji-list | read_page | ok | 9 | emojis e tabelas perfeitos; truncamento claro em 206k chars |
| 33 | F | nodejs.org/sitemap.xml | read_page | falhou | 3 | **URLs coladas** umas nas outras (BUG-1) |
| 34 | F | g1.globo.com/sitemap.xml | read_page | falhou | 3 | idem, sitemap index |
| 35 | F | hnrss.org/frontpage | read_page | parcial | 4,5 | `]]>` vazando; títulos viram `#`; URLs coladas (BUG-2) |
| 36 | F | jsonplaceholder.typicode.com/posts/1 | read_page | falhou* | 5 | rejeição limpa: "nao e HTML (application/json)" |
| 37 | F | africau.edu/images/default/sample.pdf | read_page | falhou | 3 | **URL morta** (404); teste de PDF não realizado |
| 38 | F | google.com/robots.txt | read_page | falhou | 2 | **linha única — inutilizável** para robots (BUG-1) |
| 39 | F | googlelogo_color_272x92dp.png | read_page | falhou* | 6 | rejeição limpa e rápida (image/png) |
| 40 | F | pt.wikipedia.org/wiki/Segunda_Guerra_Mundial | read_page | ok | 8 | 364.548 → 50.283 chars com marcador claro; 409 links |
| 41 | G | httpbin.org/redirect/3 | read_page | ok | 8 | 3 saltos seguidos; JSON final rejeitado limpo |
| 42 | G | httpbin.org/redirect/9 | read_page | ok | 8 | limite de 5 saltos respeitado, mensagem clara (4,6 s) |
| 43 | G | httpbin.org/status/404 | read_page | ok | 6 | claro, mas 3,1 s (BUG-6) |
| 44 | G | httpbin.org/status/403 | read_page | ok | 6 | claro, 3,8 s |
| 45 | G | httpbin.org/status/429 | read_page | ok | 6 | claro, 3,9 s |
| 46 | G | httpbin.org/status/500 | read_page | ok | 6 | claro, 5,7 s |
| 47 | G | httpbin.org/status/503 | read_page | ok | 6 | claro, 4,6 s |
| 48 | G | httpbin.org/delay/15 | read_page | ok | 7 | aguentou os 15 s; JSON rejeitado limpo |
| 49 | G | self-signed.badssl.com | read_page | falhou | 3 | **"Erro: fetch failed"** (18 chars, sem diagnóstico) |
| 50 | G | expired.badssl.com | read_page | falhou | 3 | idem (BUG-4) |
| 51 | G | info.cern.ch/hypertext/WWW/TheProject.html | read_page | ok | 9,5 | HTML de 1992 em http puro: perfeito |
| 52 | H | httpbin.org/redirect-to?url=http://127.0.0.1/ | read_page | ok | 10 | bloqueado no salto; mensagem com endereço exato |
| 53 | H | httpbin.org/redirect-to?url=http://169.254.169.254/ | read_page | ok | 10 | idem, metadata coberto |
| 54 | H | httpbin.org/redirect-to?url=http://localhost/ | read_page | ok | 10 | resolve `::1` e barra |
| 55 | H | http://[::1]/ | read_page | ok | 10 | loopback IPv6 direto barrado |
| 56 | H | http://[::ffff:127.0.0.1]/ | read_page | ok | 9,5 | barrado; msg `::ffff:7f00:1` (correta, menos legível) |
| 57 | I | read_multiple_pages: example, 404, 169.254, delay/5, 500 | read_multiple_pages | ok | 8 | isolamento por URL com motivo; "1/5 OK"; sem travar |
| 58 | I | pt.wikipedia.org/wiki/Node.js | extract_links | ok | 8,5 | 218 achados, limite, interno/externo, acentos |
| 59 | I | motherfuckingwebsite.com | discover_urls | ok | 7 | mensagem honesta: sem sitemap e sem links internos |
| 60 | I | motherfuckingwebsite.com | crawl_site | ok | 8 | 1 página — o site não tem links internos (correto) |
| 61 | I | http://169.254.169.254/ | crawl_site | ok | 10 | isError, **não** "0 páginas" |
| 62 | I | example.com (1ª leitura) | read_page | inválido | — | teste contaminado: URL já estava em cache (caso 57) |
| 63 | I | example.com (2ª leitura) | read_page | inválido | — | idem; ambas as leituras a 7 ms |
| 64 | F | w3.org/…/dummy.pdf (**substituta**) | read_page | falhou | 3 | 403 do w3c; 2ª tentativa de URL viva para PDF |
| 65 | F | jsonplaceholder.typicode.com/posts/1 | read_dynamic_page | falhou* | 5,5 | mesma rejeição limpa do read_page |
| 66 | I | example.com/?campo-fit=cache-1 (1ª) | read_page | ok | 9,5 | 720 ms — leitura de rede real, URL fresca |
| 67 | I | example.com/?campo-fit=cache-1 (2ª) | read_page | ok | 9,5 | 20 ms — cache (36× mais rápido) |
| 68 | D | pt.wikipedia.org/wiki/Copa_do_Mundo_FIFA | read_page | ok | 7,5 | infobox com rowspan converte bem; tabelão de edições além do teto de 50k |
| 69 | D | pt.wikipedia.org/wiki/Tabela_periódica (maxChars 60k) | read_page | ok | 7 | 12 tabelas convertidas na janela de 50k; grade ainda é imagem |
| 70 | E | ipea.gov.br/portal (ISO-8859-1) | read_page | ok | 8,5 | acentos perfeitos (Econômica, Notícias, Políticas); logo repetido 3× |

<!-- SECAO4 -->

## 3. Bugs encontrados

### BUG-1 — Texto puro e XML perdem todas as quebras de linha · severidade **alto**

- **Repro:** `read_page { url: "https://www.google.com/robots.txt", maxChars: 2000 }` (caso 38, `campo/raw/38-f-robots-txt.md`) e `read_page { url: "https://nodejs.org/sitemap.xml", maxChars: 3000 }` (caso 33, `campo/raw/33-f-sitemap-xml.md`).
- **Obtido:** `User-agent: * User-agent: Yandex Disallow: /search Allow: /search/about …` — tudo em uma linha. No sitemap: `https://nodejs.org/en/download/current 2026-10-14T15:53:14.218Z always https://nodejs.org/en/download …` — `<loc>`, `<lastmod>` e `<changefreq>` colados.
- **Esperado:** uma diretiva por linha, como no arquivo original; URLs e datas separadas.
- **Hipótese:** `server.js:602` — `emit(preDepth > 0 ? decoded : decoded.replace(/\s+/g, " "))`. Todo token de texto fora de `<pre>` tem qualquer sequência de espaços (inclusive `\n`) convertida em um espaço. Em HTML isso é correto porque as tags de bloco (`p`, `div`, `li`…) emitem seus próprios `\n` (linhas 617–627, 701–710). Mas `ensureHtml` (`server.js:1355-1361`) deixa passar `text/plain` e `xml`, e nesses formatos não existe tag de bloco nenhuma: a quebra de linha era a única estrutura do arquivo, e ela é destruída. Afeta também arquivos raw: casos 4 e 6 (README.md e package.json em linha única — justamente os `/guide/introduction.md` que o próprio Vue docs recomenda para IAs).
- **Correção sugerida:** antes de converter, se o content-type for `text/plain` (ou o conteúdo não tiver tags HTML), quebrar o texto em parágrafos (`<p>` por bloco de linhas) ou manter `\n` nos tokens de texto nesse modo. Tags XML desconhecidas deveriam emitir `\n` no fechamento.

### BUG-3 — `read_dynamic_page` degrada página SSR rica · severidade **alto**

- **Repro:** `read_dynamic_page { url: "https://react.dev/learn", maxChars: 5000 }` (caso 13, `campo/raw/13-b-react-read-dynamic.md`).
- **Obtido:** 5.323 caracteres de JSON escapado — `{"className":"language-js","children":"function MyButton() {\n …"}` — com rótulo "Pagina dinamica — dados extraidos do HTML embutido" e apenas 4 cercas de código.
- **Esperado:** o mesmo que o `read_page` deu no caso 12 (`campo/raw/12-b-react-read-page.md`): 17.465 caracteres, 18 cercas, texto e código corretos.
- **Hipótese:** `isDynamicPage` (`server.js:1422-1429`) considera a página dinâmica só por conter a marca de framework (`__NEXT_DATA__`), sem olhar se a extração estática já é rica. Em `toolReadDynamicPage` (`server.js:1641-1656`), havendo dados embutidos, o markdown bom é **substituído** sem comparação de qualidade. O `read_page` tem a guarda correta (`server.js:1373`: só tenta dados embutidos se a extração estática tem < 300 caracteres) — a ferramenta dinâmica não tem.
- **Correção sugerida:** espelhar a guarda do `read_page`: usar os dados embutidos só quando o markdown estático for curto, ou apenas se o dinâmico for maior/mais informativo que o estático.

### BUG-5 — SPA devolve 0 caracteres com cara de sucesso · severidade **médio/alto**

- **Repro:** `read_page { url: "https://hn.algolia.com/?query=javascript", maxChars: 3000 }` (caso 18) e `read_page { url: "https://www.bcb.gov.br/", maxChars: 4000 }` (caso 27).
- **Obtido:** título e descrição corretos, `Conteudo: 0 caracteres`, `isError: false`. Nada indica que o conteúdo depende de JavaScript. `read_dynamic_page` existe justamente para isso, mas nada na saída sugere usá-la.
- **Esperado:** no mínimo um aviso no rótulo — "conteudo pode depender de JavaScript; tente read_dynamic_page".
- **Hipótese:** `server.js:1372-1378` — quando a extração é curta e `isDynamicPage` é verdadeiro, o servidor tenta `extractEmbeddedData`; se ela não acha nada, volta ao markdown curto **sem nenhum aviso** (não existe o ramo "else" com rótulo, ao contrário do `read_dynamic_page` em `server.js:1666`).

### BUG-4 — Certificado SSL inválido devolve "fetch failed" sem diagnóstico · severidade **médio**

- **Repro:** `read_page { url: "https://self-signed.badssl.com/", maxChars: 500 }` (caso 49) e `https://expired.badssl.com/` (caso 50).
- **Obtido:** `Erro: fetch failed` — 18 caracteres, sem causa.
- **Esperado:** a causa do Node está disponível em `err.cause.code` (`SELF_SIGNED_CERT_IN_CHAIN`, `CERT_HAS_EXPIRED`) e deveria entrar na mensagem — "certificado SSL inválido (auto-assinado)" diz à IA o que fazer; "fetch failed" não diz nada.
- **Hipótese:** o catch do laço de fetch (~`server.js:1150-1175`) transforma a exceção em `HTTP …`/mensagem genérica e descarta `err.cause`.

### BUG-2 — CDATA de feed RSS é mal tratada · severidade **médio**

- **Repro:** `read_page { url: "https://hnrss.org/frontpage", maxChars: 4000 }` (caso 35, `campo/raw/35-f-rss-frontpage.md`).
- **Obtido:** `]]>` vazando no meio do texto; `<title>` dentro do CDATA interpretado como tag real (`# Comments: 29` vira cabeçalho); URLs coladas. O texto dos artigos e os links sobrevivem, mas o feed sai sujo.
- **Esperado:** conteúdo do CDATA como texto puro, sem `]]>` e sem transformar HTML interno em estrutura de página.
- **Hipótese:** `server.js:495-499` — `<![CDATA[` cai no ramo de declarações (`<!`), que pula até o primeiro `>`; mas o primeiro `>` está dentro do próprio CDATA, então o resto do conteúdo é re-parseado como HTML e o `]]>` final vira texto.

### BUG-6 — Erros de status levam 3–5,7 s por causa do retry · severidade **médio**

- **Repro:** casos 43–47 (`httpbin.org/status/404|403|429|500|503`): 3.069, 3.790, 3.919, 5.694 e 4.621 ms.
- **Obtido:** mensagens claras, mas depois de múltiplas tentativas com backoff.
- **Esperado:** 404/403/500 são respostas definitivas — não deveriam ser retentados (só 429/503 com `Retry-After` e erros de rede).
- **Hipótese:** `server.js:1169-1172` — a flag `retriable` marca 404/403/500 como recuperáveis e o `sleep(400 * 2 ** attempt)` estica a latência a cada tentativa.

### BUG-7 — Ruído de chrome em páginas de código do GitHub · severidade **baixo**

- **Repro:** caso 5 (`campo/raw/05-a-github-blob-package.json`).
- **Obtido:** números de linha `1` a `17` como texto antes de cada linha do JSON, bloco "Copy path / More file actions / Latest commit" duplicado, e na listagem de arquivos (caso 3) a coluna "Name" aparece duplicada (`| [load](…) | [load](…) | | |`).
- **Esperado:** só o conteúdo do arquivo; a listagem sem coluna repetida.
- **Hipótese:** o parser é fiel ao HTML — o GitHub renderiza a célula de nome duas vezes (desktop/mobile) e os números de linha são elementos reais. Fidelidade correta, utilidade baixa: falta filtro de chrome conhecido.

### BUG-8 — Replicação de blocos de código no react.dev · severidade **baixo**

- **Repro:** caso 12 (`campo/raw/12-b-react-read-page.md`).
- **Obtido:** o mesmo código aparece duas vezes — primeiro com cada linha separada por linha em branco (cópia do sandpack interativo), depois limpo (cópia estática). Some com a janela de 5.000 caracteres.
- **Esperado:** uma cópia, limpa.
- **Hipótese:** a página realmente contém as duas versões; o `<pre>` interno ao sandpack tem elementos por linha/elemento, e o texto dentro de `<pre>` preserva quebras (`server.js:602`, ramo `preDepth > 0`), que somadas às dos elementos produzem a linha em branco entre cada linha.

**Cosméticos:** frases de status em maiúsculas quando o site manda maiúsculas (`HTTP 404 NOT FOUND`, caso 43) vs. misto (`HTTP 404 Not Found`, caso 37); IPv4 mapeado exibido como `::ffff:7f00:1` em vez de `::ffff:127.0.0.1` (caso 56).

<!-- SECAO5 -->

## 4. Padrões recorrentes de qualidade de extração

Não são bugs de repro determinístico, mas comportamento que aparece em site após site e que a IA consumidora sempre encontra:

1. **Manchete engaiolada em link.** Portais (UOL, Folha, BBC, IPEA, WordPress) emitem `[\n\n## Título\n\n](url)` — markdown válido, mas o título fica depois de um colchete vazio e a leitura fica truncada visualmente. Seria melhor `[## Título](url)` ou o título fora do link.
2. **`[` e `]` órfãos.** Links sem texto (carrosséis, bolhas) geram colchetes soltos no meio do texto (UOL caso 20, BBC caso 21).
3. **Nav antes do conteúdo.** "Skip to content", "Minha Folha", barras do Governo e links com `utm_*` aparecem antes da primeira manchete (casos 20, 23, 70).
4. **Imagens com alt gigante.** A BBC embarraca um parágrafo de 300+ caracteres de descrição da foto a cada notícia (caso 21). Placeholders (`grey-placeholder.png`) e a mesma logo repetida 3× (variantes responsivas, caso 70) também passam.
5. **`utm_source=pt.wikipedia.org` nas thumbnails.** Todas as miniaturas da Wikipédia chegam com parâmetros de rastreio (casos 24, 25, 40, 68, 69).
6. **Âncoras de edição.** `[editar]`, `[editar código]` e `¶` no fim dos cabeçalhos da Wikipédia (casos 40, 68).
7. **Teto duro de ~50 mil caracteres por saída.** Pedir `maxChars: 60000` devolve 50.276 (caso 69). Consequência prática: em artigos longos, tabelas grandes que estão depois da dobra (o tabelão de edições da Copa, caso 68) ficam **fora de alcance** — a IA precisa fatiar por seções via `extract_links`.
8. **Código em `<pre>` com linha em branco entre cada linha.** GitHub blob (caso 5) e a primeira cópia dos exemplos do react.dev (caso 8/12) saem com respiro duplo; a segunda cópia do react.dev sai limpa. Inconsistência dentro da mesma página.
9. **Fórmulas matemáticas como LaTeX-texto.** `{\displaystyle ...}` mais o link da imagem SVG (caso 8) — legível por quem sabe LaTeX, perdido para o resto.

## 5. Desempenho

- **Páginas OK:** 146 ms (BBC) a 2.461 ms (Wiki matemática); mediana ≈ 700 ms. Docs SSR: 344–1.328 ms. Páginas com muito link (Japão, 104 links; WWII, 409 links) ficaram em 0,8–1,8 s.
- **Cache:** leitura fresca 720 ms → 2ª leitura 20 ms (**36×**, casos 66/67). Cache entre ferramentas aparece naturalmente (caso 11 a 25 ms, caso 60 a 9 ms).
- **Erros de status:** 3,1–5,7 s por causa do retry (BUG-6); `redirect/9` 4,6 s; `delay/15` 12,2 s (aguentou, sem estourar timeout).
- **Blindagens de rede:** `fetch failed` em 0,7–0,9 s; bloqueios SSRF em 4–12 ms (endereço conhecido, sem DNS).
- **Maiores saídas:** 50.283 caracteres (WWII, teto de ~50k) e 50.276 (tabela periódica com `maxChars` 60k — o teto manda). Maiores páginas processadas inteiras: 393.293 (ja 日本), 364.548 (WWII), 216.913 (ar), 206.845 (emoji), 128.057 (sitemap nodejs).
- **Memória e carga:** boot `rss: 46 MB`; fim da bateria `rss: 79 MB`, cache com 38 entradas / 14,26 MB de 67,1 MB, 0 requisições ativas, 0 downloads ativos, 0 recusas, pico de download 0 MB de 128 MB — estável do começo ao fim. Rate limit padrão verificado em instância separada: 429 a partir da chamada 61 (5 de 65).
- **Leitura correta:** medir carga só por HTTP 200 mente (o servidor devolve 200 com `result.isError`) — todas as métricas aqui usam o texto extraído e o `isError`, não o status.

## 6. O que não deu para testar e por quê

| Item | Motivo | Registro |
|------|--------|----------|
| Conteúdo do Stack Overflow, npmjs, IBGE, w3c | 403 dos próprios sites (proteção anti-bot). Respeitado, não burlado | casos 7, 16, 17, 26, 64 |
| PDF de verdade | URL original morreu (africau.edu, 404) e a substituta (w3c) deu 403. O comportamento de rejeição por content-type segue não testado | casos 37, 64 |
| Encoding ISO-8859-1 do BCB | o site virou SPA (0 caracteres). Substituído pelo IPEA, que serve ISO-8859-1 de verdade e passou | caso 27 vs. caso 70 |
| Tabelas com colspan/rowspan profundas | arts. longos: o tabelão de edições da Copa cai depois do teto de ~50k caracteres | caso 68 |
| Corpo de notícia com paywall | só manchetes (sem login, como manda a regra) | caso 23 |
| Cache A/B da bateria principal | contaminado: a URL já estava em cache do `read_multiple_pages`. Refeito com URL fresca nos casos 66/67 | casos 62/63 |
| `robots.txt` sendo consultado | comportamento ausente (pauta conhecida, fora do escopo desta rodada) | — |

## 7. Lista priorizada do que corrigir primeiro

1. **BUG-1** — preservar quebras de linha em `text/plain` e XML (`server.js:602` + `ensureHtml` 1355). É a correção que salva robots.txt, sitemaps e arquivos raw — os conteúdos mais máquina da web, e justamente os que uma IA mais consome.
2. **BUG-3** — `read_dynamic_page` só deve usar dados embutidos quando a extração estática for pobre (`server.js:1428`, 1641-1656; espelhar a guarda de 1373). Hoje a ferramenta pode piorar o resultado conscientemente.
3. **BUG-5** — avisar "conteudo pode depender de JavaScript; tente read_dynamic_page" quando a extração der ~0 caracteres em página dinâmica (`server.js:1372-1378`).
4. **BUG-2** — tratar `<![CDATA[ … ]]>` como texto no tokenizer (`server.js:495-499`). Feed RSS é caso de uso comum.
5. **BUG-4** — incluir `err.cause.code` na mensagem de falha de fetch (~`server.js:1150-1175`).
6. **BUG-6** — não retentar 404/403/500 (`server.js:1169`); corta 3–5,7 s de latência em todo erro definitivo.
7. **BUG-7/BUG-8 + cosméticos** — filtro de chrome do GitHub (números de linha), dedupe de blocos de código idênticos, `[` `]` órfãos, `utm_*` em thumbnail, `::ffff:7f00:1` → `::ffff:127.0.0.1`, frase de status normalizada.

## Como reproduzir

```
node campo/driver.mjs     # bateria principal: 63 casos, ~3,5 min
node campo/extras.mjs     # 7 casos extras (PDF, JSON, cache, tabelas, ISO-8859-1)
node campo/../scripts/live-test.mjs <url> <token>   # verificação pós-deploy (26 checagens)
```

Saídas brutas: `campo/raw/*.md` (um por caso, com JSON-RPC completo e texto extraído). Métricas: `campo/resultados.json`, `campo/extras.json`, `campo/ratelimit.json`. Log do servidor: `campo/server.log`.