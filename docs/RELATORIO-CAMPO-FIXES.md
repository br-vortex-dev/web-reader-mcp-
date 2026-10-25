# RELATÓRIO DE CORREÇÕES — rodada de campo (bugs 1–8)

> Rodada executada em 14/10/2026, sobre os 8 bugs registrados no `RELATORIO-CAMPO.md`. **Todos os 8 corrigidos, um commit por item, suíte fechada verde.**

## Disciplina da rodada

- **Baseline vermelha primeiro:** `fd3b884` criou `tests/campo-fixes.test.mjs` com 11 regressões (uma por bug, 3 para o BUG-1) — **11/11 vermelhas** antes de qualquer correção. Nenhum teste foi escrito "para passar".
- **Um commit por bug**, prefixo `fix(escopo):`, cada um com a suíte completa rodada antes e depois. Onde duas correções caíram no mesmo arquivo ao mesmo tempo, o commit foi desfeito (`reset --mixed`) e refeito separado — aconteceu uma vez (BUG-5 e BUG-2 dividiam o `server.js`).
- **Escopo fechado:** problemas novos encontrados no caminho foram anotados, não corrigidos — com uma exceção, a regressão que a própria correção do BUG-7 provocou (seção 4).

## 1. Resumo

| Bug | Severidade | O que era | Commit |
|-----|-----------|-----------|--------|
| BUG-1 | alto | texto puro/XML perdia todas as quebras de linha | `6f3ae8a` |
| BUG-3 | alto | `read_dynamic_page` trocava SSR rico por dump de JSON | `4ddbf11` |
| BUG-5 | médio/alto | SPA devolvia "0 caracteres" com cara de sucesso | `5a7308a` |
| BUG-2 | médio | CDATA de feed vazava `]]>` e markup pela metade | `b66b434` |
| BUG-4 | médio | "fetch failed" sem a causa real do erro | `7aedb57` |
| BUG-6 | médio | 401/403/500 retentados: 3–5,7 s de latência à toa | `368567b` |
| BUG-7 | baixo | chrome `aria-hidden` (nº de linha, stat duplicada) vazava | `2ea553a` |
| BUG-8 | baixo | `<pre>` com elemento por linha explodia em branco | `9ddbbac` |

Suíte: **66 → 78 testes** (77 passam, 1 `skip` de sinal no Windows). As 12 regressões de `tests/campo-fixes.test.mjs` passam.

## 2. Antes → depois, bug por bug

### BUG-1 — texto puro e XML voltam como vieram (`6f3ae8a`)

- **Antes:** `robots.txt` saía em linha única — `User-agent: * User-agent: Yandex Disallow: / …`, ou seja, **a diretiva restritiva do Yandex passava a valer para todo mundo**. Sitemap com `<loc>`, `<lastmod>` e `<changefreq>` colados; `README.md` e `package.json` raw em linha única.
- **Causa:** `htmlToMarkdown` colapsa `\s+` em espaço em qualquer token de texto fora de `<pre>` (correto em HTML, onde as tags de bloco emitem seus próprios `\n`; destrutivo em texto puro, onde a quebra de linha *é* a estrutura do arquivo).
- **Depois:** `isConteudoBruto(contentType, html)` despacha **antes do parser** nas 4 rotas de leitura (`read_page`, `read_dynamic_page`, `readOnePage`, `crawlOnePage`). `text/plain` e qualquer XML passam por `conteudoBrutoResult()`: `\n` preservado, `\r\n` normalizado, truncamento respeitado. HTML continuou indo para o parser — content-type e aparência do corpo são os dois critérios.
- **Regressão:** 3 testes em `campo-fixes` (grupos do `robots.txt`, linhas do sitemap, parágrafos do `.md`).

### BUG-2 — CDATA inteira vira texto, sem vazar `]]>` (`b66b434`)

- **Antes:** `hnrss.org/frontpage` saía com `]]>` no meio do texto e o `<title>` dentro do CDATA era interpretado como tag real (`# Comments: 29` virava cabeçalho).
- **Causa:** `<!` caía no ramo de declarações, que pula até o **primeiro** `>` — e o primeiro `>` está dentro do próprio CDATA. O resto do feed era re-parseado como HTML.
- **Depois:** ramo `<![CDATA[` explícito no tokenizer: o conteúdo inteiro vira um token de texto `raw` (sem decodificar entidades) e o `]]>` de fechamento desaparece do resultado. O token `raw` também atravessa o parser sem decodificação — texto literal é texto literal.
- **Regressão:** 2 testes (Atom cru com CDATA e newlines; CDATA dentro de HTML não vaza `]]>`).

### BUG-3 — página SSR rica não perde para dump de JSON (`4ddbf11`)

- **Antes:** `read_dynamic_page` em `react.dev/learn` entregava 5.323 caracteres de JSON escapado (4 cercas de código) onde o `read_page` tinha entregado 17.465 caracteres e 18 cercas.
- **Causa:** `isDynamicPage` disparava só pela marca `__NEXT_DATA__`, e a ferramenta dinâmica **substituía** o markdown estático sem comparar qualidade. O `read_page` já tinha a guarda certa (só tentar dados embutidos se a extração estática tem < 300 caracteres); a dinâmica não tinha.
- **Depois:** espelho da guarda — `estaticoCompleto` (≥ 300 caracteres visíveis). Havendo SSR rico, o markdown estático é devolvido com rótulo honesto ("dados embutidos não substituíram — markdown completo").
- **Regressão:** fixture `/ssr-rico`; o teste exige o bloco python exatamente igual a `def soma(a, b):\n    return a + b\n`.

### BUG-4 — erro de rede expõe a causa real (`7aedb57`)

- **Antes:** certificado SSL inválido devolvia 18 caracteres — `Erro: fetch failed` — sem dizer `SELF_SIGNED_CERT_IN_CHAIN` nem `CERT_HAS_EXPIRED`.
- **Causa:** o `fetch` do Node embrulha a falha em `TypeError: fetch failed` e guarda o motivo em `err.cause`; o catch descartava o `cause`.
- **Depois:** `erroComCausa(err)` reconstrói a mensagem a partir do `cause` (inclusive `AggregateError` do happy-eyeballs, que traz `cause.errors[]`), copia `retryAfterMs` e mantém `.cause` para quem investiga.
- **Regressão:** conexão recusada em porta fechada — a mensagem cita `ECONNREFUSED`/`connect` e **não** é mais o `fetch failed` pelado.

### BUG-5 — página sem conteúdo estático avisa o que fazer (`5a7308a`)

- **Antes:** SPA (`hn.algolia.com`, `bcb.gov.br`) devolvia título e descrição corretos, `Conteudo: 0 caracteres`, `isError: false`. Nada indicava que o conteúdo depende de JavaScript.
- **Depois:** rótulo `Aviso: 0 caracteres de conteudo estatico — a pagina provavelmente e renderizada por JavaScript. Tente read_dynamic_page.`
- **Regressão:** fixture `/vazia` (SPA shell + meta description) — o teste exige o aviso, o texto `Um app` da meta e o `Conteudo: 0 caracteres`.

### BUG-6 — 401/403 definitivos não são mais retentados (`368567b`)

- **Antes:** httpbin 403/500 levava 3,8–5,7 s (3 tentativas com backoff de 400 ms · 2^n) para devolver uma resposta que **não mudaria**.
- **Depois:** conjunto `retriable` reduzido a 429/503/500. `Retry-After` continua respeitado.
- **Regressão:** fixture `/negado` (403 com contador); `read_page` bota a contagem em **1** (era 3).

### BUG-7 — aria-hidden não vaza para o texto (`2ea553a`)

- **Antes:** blob do GitHub saía com números de linha 1–17 antes de cada linha e a estatística "17 lines (17 loc) · 710 Bytes" em duplicidade (a cópia decorativa é `aria-hidden="true"`).
- **Depois:** subárvore com `aria-hidden="true"` é ignorada — a mesma decisão que o leitor de tela toma. Destaca-se o caso da coluna "Name" duplicada do GitHub, que esse filtro resolve de graça.
- **Regressão:** fixture `/github-like`; "17 lines (17 loc)" aparece **exatamente uma vez** e números de linha não viram cabeçalho de tabela. Ver também a seção 4 — a regressão que essa correção provocou e como foi pega.

### BUG-8 — linha de código em `<pre>` não explode (`9ddbbac`)

- **Antes:** bloco do react.dev saía com uma linha em branco entre cada linha de código (a cópia do sandpack interativo embrulha cada linha no próprio elemento).
- **Causa:** tags de bloco (`div`, `p`, `li`…) emitem `\n` ao abrir e fechar. Dentro de `<pre>` essas quebras **somam** às do próprio fonte, que já tem as suas.
- **Depois:** `PRE_SILENCE_TAGS` — tags de bloco ficam mudas enquanto `preDepth > 0`. A formatação do código vem das quebras do próprio fonte, e só delas.
- **Regressão:** fixture `/react-like`; o bloco tem de sair **exatamente** `function Soma() {\n  return 1 + 1;\n}\n`.

## 3. Um achado de caminho (não era bug de campo)

O `jsonToMarkdown`/`extractEmbeddedData` (corredor de dados embutidos) só dispara quando o markdown estático tem < 300 caracteres. Quando ele dispara sem ter nada útil para entregar (página pequena, sem JSON embutido), devolve `null` e o markdown original sobrevive — o corredor é inofensivo, só não serve para nada nesse caso. Fica registrado; não foi mexido.

## 4. A regressão que a própria correção do BUG-7 provocou

A primeira versão do filtro `aria-hidden` contava `skipDepth++` para **qualquer** tag com o atributo. A suíte completa acusou falha no teste de integração ao vivo (`pt.wikipedia.org/wiki/Node.js`):

- **Sintoma:** o artigo saiu com **914 caracteres** — só o JSON-LD, numa lista aninhada — em vez de 31.043.
- **Causa:** `<img aria-hidden="true">` do logo da Wikipédia é **tag void**: não tem fecho. O `skipDepth` subia e nunca descia, travando acima de zero — e tudo depois do logo era descartado. O JSON-LD que apareceu no lugar é sintoma, não causa: com o markdown curto demais, o `read_page` caiu no corredor de dados embutidos.
- **Correção:** tag void/self-closing não mexe em `skipDepth` — não há subárvore para pular. O mesmo conserto vale para o ramo `isSkipped` (nenhuma tag de `SKIP_TAGS` é void hoje, mas `<script/>` autofechadoexistia como armadilha dormente).
- **Regressão dedicada:** fixture `/aria-void` (`<img aria-hidden>` + texto depois). **Provada vermelha:** com a guarda removida, o teste falha; com ela, passa. É o teste que impede esse erro de voltar.

Lição que já valia para o projeto e se confirmou: correção de parser precisa de teste com **tag void**, **tag aninhada de mesmo nome** e **HTML real de site grande** — o fixture bonito não pega essas.

## 5. O que não foi mexido (escopo fechado)

Cosméticos anotados no relatório de campo e **de fora** desta rodada: frases de status em maiúsculas (`HTTP 404 NOT FOUND`), IPv4 mapeado exibido como `::ffff:7f00:1`, `utm_source` nas thumbnails da Wikipédia, âncoras `[editar]`/`¶`, manchetes engaioladas em link, `[`/`]` órfãos, nav antes do conteúdo, alt gigante, e o teto de ~50 mil caracteres por saída. Nada disso foi tocado.

## 6. Validação

- `npm test`: **78 testes, 77 passam, 1 skip** (teste de sinal `SIGTERM`, `skip` no Windows — o `child.kill("SIGTERM")` não entrega o sinal lá).
- Teste de integração ao vivo (Wikipedia, github.com, httpbin) passando — inclusive o que pegou a regressão da seção 4.
- Verificação manual pontual: `read_page` na Wikipédia devolve 31.043 caracteres com infoboxes em tabela GFM válida (`| --- |`), seções e código.

## 7. Commits da rodada

```
fd3b884 test: regressoes dos 8 bugs da rodada de campo (baseline vermelha)
6f3ae8a fix(leitura): texto puro e XML voltam como vieram (BUG-1)
4ddbf11 fix(dynamic): pagina SSR rica nao perde para dump de JSON (BUG-3)
5a7308a fix(read): pagina sem conteudo estatico avisa o que fazer (BUG-5)
b66b434 fix(parser): CDATA inteira vira texto, sem vazar ]] (BUG-2)
7aedb57 fix(fetch): erro de rede expoe a causa real (BUG-4)
368567b fix(fetch): 401/403 definitivos nao sao mais retentados (BUG-6)
2ea553a fix(parser): aria-hidden nao vaza pro texto (BUG-7)
9ddbbac fix(parser): linha de codigo em <pre> nao explode (BUG-8)
```

Push para o `origin/main` dispara o deploy automático no Render.
