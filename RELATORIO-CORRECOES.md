# Relatório das correções — web-reader-mcp

Data: 14/10/2026
Escopo: os 3 itens críticos da revisão + substituição do `test-security.mjs` por testes reais.
`server.js`: **1524 → 1887 linhas**. Zero dependências adicionadas (só `node:dns/promises` e `node:net`, built-ins).

Commits (um por item):

| Commit | Item |
| --- | --- |
| `d1494e6` | 1. SSRF |
| `571f9f4` | 2. Parser HTML |
| `f8690c8` | 3. Rate limit |
| `b6f9c9d` | 4. Testes reais |

**Sobre os números de linha da revisão:** todos bateram com o código real (não precisei adaptar nenhum).

---

## 1. SSRF

### Arquivos e linhas

| O que | Onde |
| --- | --- |
| Imports (`dns/promises`, `net`) | `server.js:19-20` |
| Constantes + aviso de boot | `server.js:576-588` |
| `isBlockedIpv4` | `server.js:594` |
| `embeddedIpv4` (IPv4 dentro de IPv6) | `server.js:617` |
| `isBlockedIpv6` | `server.js:632` |
| `blockedAddress` | `server.js:648` |
| `assertPublicHost` (resolve + valida) | `server.js:669` |
| `fetchNoRedirect` (redirect manual, 5 saltos) | `server.js:714-751` |
| `fetchText` passa a usar `fetchNoRedirect` | `server.js:753` |
| `fetchTextCached` valida antes do cache | `server.js:852` |
| `render.yaml` (comentário) / `README.md` (seção nova) | — |

### Antes / depois

```
ANTES                                                     DEPOIS
[127.0.0.1]      isError=false -> leu a pagina interna     [127.0.0.1]      Host bloqueado: endereco privado/interno (127.0.0.1)
[localhost]      isError=false -> leu a pagina interna     [localhost]      Host bloqueado: endereco privado/interno (::1)
[169.254.169.254] isError=true -> "operation was aborted"  [169.254.169.254] Host bloqueado: endereco privado/interno (169.254.169.254)
[10.0.0.1]       isError=true -> "operation was aborted"   [10.0.0.1]       Host bloqueado: endereco privado/interno (10.0.0.1)
[[::1]]          isError=true -> "fetch failed"            [[::1]]          Host bloqueado: endereco privado/interno (::1)
[[::ffff:127.0.0.1]] isError=false -> LEU a pagina interna [[::ffff:127.0.0.1]] Host bloqueado: endereco privado/interno (::ffff:7f00:1)
```

Repare na coluna "antes": `169.254.169.254` e `10.0.0.1` davam erro, mas **por timeout, não por bloqueio** — o servidor tentou conectar de verdade. Agora a mensagem prova o bloqueio.

O caso mais grave era o redirect:

```
ANTES
  [redirect publico -> 127.0.0.1] isError=false
  -> "# Fixture Parser / URL: http://127.0.0.1:4111/pagina"     <-- httpbin.org (publico) redirecionou
                                                                    e o servidor LEU a pagina interna

DEPOIS
  [redirect publico -> 127.0.0.1] isError=true
  -> "Erro: Host bloqueado: endereco privado/interno (127.0.0.1)"
```

### O que foi implementado

- **Resolução antes de qualquer requisição:** `assertPublicHost` faz `dns.lookup(host, { all: true })` e recusa se **qualquer** endereço resolvido for privado (bloqueia também hostname que resolve para vários IPs mistos). Hostname literal (`localhost`, `*.internal`) cai na mesma regra via resolução.
- **Faixas IPv4:** `0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.168/16`, `224/4` e acima (`a >= 224`).
- **Faixas IPv6:** `::`, `::1`, `fe80::/10`, `fc00::/7`, `ff00::/8`. **IPv4 mapeado (`::ffff:0:0/96`), NAT64 (`64:ff9b::/96`) e 6to4 (`2002::/16`) extraem o IPv4 embutido e validam ele** — não bloqueia o IPv6 inteiro cegamente. Foi exatamente por aqui que o bypass do `::ffff:127.0.0.1` aparecia.
- **Redirects:** `redirect: "manual"` + loop de até **5 saltos**, com `assertPublicHost` rodando **em cada hop**, `new URL(location, currentUrl)` para resolver `Location` relativo, e recusa de protocolo diferente de http/https.
- **Centralizado no fetch de baixo nível** (`fetchText`), então vale para `read_page`, `extract_links`, `read_multiple_pages`, `discover_urls`, `crawl_site`, `read_dynamic_page` e para `extractEmbeddedData` (o `tryInternalApi`, que busca "APIs internas" citadas na página, passa por `fetchTextCached`). Verificado por teste: os 5 caminhos bloqueiam.
- **Validação antes do cache:** `fetchTextCached` chama `assertPublicHost` antes de olhar o LRU, então URL bloqueada não é servida nem popula o cache.
- **`ALLOW_PRIVATE_HOSTS=1`** desliga o bloqueio; avisa em `stderr` no boot. Documentado no README e com comentário no `render.yaml` dizendo para **não** definir no Render.
- **Mensagem curta e sem detalhes de rede interna:** `Host bloqueado: endereco privado/interno (x.x.x.x)`.

### Limitação que permanece (documentada no código)

Sobra uma **janela de DNS rebinding**: entre o `lookup` da validação e a conexão do `fetch` o DNS poderia apontar para outro IP. Fechar isso exigiria fixar o IP de destino na conexão, o que o `fetch` do Node não permite — resolver na mão significaria abandonar o `fetch` ou adicionar dependência. Está comentado em `server.js:669-678`, não resolvido.

### Custo de performance

Cada requisição de saída faz um `dns.lookup`. Mitigado com um cache de validação de host (TTL 60 s, teto 500 entradas) — na prática, um crawl de 30 páginas faz 1 lookup por host, não 30.

---

## 2. Parser HTML

### 2a. `<` solto no texto — `server.js:172-183`

```
ANTES:   CASO 1 (menor-que no texto): Compare 3 3 neste paragrafo.
DEPOIS:  CASO 1 (menor-que no texto): Compare 3 < 5 e 5 > 3 neste paragrafo.

ANTES:   CASO 9 (menor-que no fim do documento):            <-- o "<" sumiu
DEPOIS:  CASO 9 (menor-que no fim do documento):
         <
```

Implementada a regra do HTML: `<` só inicia tag se vier letra ASCII, `/`, `!` ou `?`. Qualquer outra coisa é texto literal e é emitida como texto (sem duplicar o trecho já emitido antes do `<`).

**Sobre o caso `a <b` sem fechamento:** `<b` **é** início de tag válido pela spec, então o comportamento não mudou — e não devia. `<b sem fechamento aqui</p>` continua sendo lido como a tag `<b>` com os atributos `sem`, `fechamento`, `aqui</p` (o `</p>` é engolido, como um browser faria). O texto vira atributo, não conteúdo, então não há perda de conteúdo. O resíduo é o `**` não fechado na saída (o parser não fecha tags inline órfãs) — **problema pré-existente, fora do escopo, não mexi**.

### 2b. Indentação de código — `server.js:226-238`

```
ANTES (Python)                    DEPOIS (Python)
def soma(a, b):                   def soma(a, b):
 if a > 0:                            if a > 0:
 return a + b                             return a + b
 return 0                             return 0

ANTES (YAML)                      DEPOIS (YAML)
servico:                          servico:
 nome: api                           nome: api
 portas:                             portas:
 - 80                                    - 80
 - 443                                   - 443
```

`cleanMarkdown` agora normaliza fim de linha, **mascara** cada bloco cercado, colapsa espaços só fora deles e restaura os blocos intactos. Também limpa as quebras sobrando no fim do bloco, para não sair com linhas em branco dentro da cerca.

**Limitação conhecida:** a máscara pareia as cercas ` ``` ` por regex; se o texto da própria página tiver um número ímpar de ` ``` ` literais (um artigo falando de markdown, por exemplo), o pareamento pode errar. Caso raro; não resolvido.

### 2c. Tabelas — `server.js:258-280` (render) + `server.js:317-333, 380-410` (buffer)

O conteúdo da tabela passou a ser **bufferizado por célula** (`emit` escreve na célula quando há uma aberta) e emitido de uma vez no `</table>`, o que permite gerar GFM de verdade.

```
ANTES                                          DEPOIS
 Nome | Valor |                                | Nome | Valor |
                                               | --- | --- |
 A | 1 |                                       | A | 1 |

 B|pipe | 2 |                                  | B\|pipe | 2 |
```

Medido em páginas reais: `pt.wikipedia.org/wiki/Brasil` → **0 → 1** tabela válida; `Node.js` → **0 → 4**.

- Cabeçalho: usa os `th`; sem `th`, a primeira linha vira cabeçalho (o que mantém a tabela válida).
- `|` dentro da célula é escapado (`\|`).
- Quebra de linha dentro da célula (incluindo `<br>`) vira espaço.
- Linhas com menos células são preenchidas com células vazias, então todas as linhas têm o mesmo número de colunas (validado por teste).
- `colspan`/`rowspan` degradam para uma célula; tabela aninhada apenas acumula, **sem perder texto**.
- Tabela sem `</table>` (malformada) é emitida no fim em vez de sumir.

### 2d. Entidades — `server.js:84-101` e `server.js:105-124`

```
ANTES:   Acentuacao: &ccedil;&atilde;o &eacute; &Aacute;gua &Oslash; & fim. Numericas: ç ç. Desconhecida: &naoexiste; Fora de range:
DEPOIS:  Acentuacao: ção é Água Ø & fim. Numericas: ç ç. Desconhecida: &naoexiste; Fora de range: &#99999999;
```

- Adicionado o **Latin-1 inteiro** (todas as letras acentuadas maiúsculas e minúsculas, incluindo `szlig`, `AElig`, `ETH`, `THORN`) + tipografia extra (`OElig`, `fnof`, `circ`, `tilde`, `ensp`, `emsp`, `thinsp`, `zwnj`, `zwj`, `oplus`, `otimes`). As de tipografia que você listou (`&nbsp; &mdash; &ndash; &hellip; &laquo; &raquo; &ldquo; &rdquo; &lsquo; &rsquo; &euro; &copy; &reg; &trade;`) já existiam.
- Numéricas decimal e hexa já funcionavam e continuam funcionando.
- Entidade desconhecida continua mantida como texto.
- **Corrigido:** código numérico inválido/fora de range (`&#99999999;`) agora mantém o texto original — antes devolvia `""` e **sumia com o trecho**.

---

## 3. Rate limit

### Arquivos e linhas

`server.js:1682-1724` (config, `clientIpOf`, GC) e `server.js:1789-1821` (uso por requisição). `render.yaml` (`TRUST_PROXY_HOPS: 1`) e `README.md` (seção "Rate limit e `x-forwarded-for`").

### Antes / depois

```
ANTES (rotacionando x-forwarded-for):   HTTP 200: 80   HTTP 429: 0    -> BURLADO
DEPOIS:                                 HTTP 200: 60   HTTP 429: 20   -> limitado corretamente
```

### Comportamento por configuração (verificado)

| Cenário | Resultado |
| --- | --- |
| `TRUST_PROXY_HOPS=0` (padrão), XFF rotativo | 60× 200, 5× 429 → **não burla** (chave = IP do socket) |
| `TRUST_PROXY_HOPS=1`, forjando o lado **esquerdo** (`10.1.1.N, 9.9.9.9`) | 60× 200, 10× 429 → **não burla** |
| `TRUST_PROXY_HOPS=1`, rotacionando o lado **direito** | 70× 200, 0× 429 → clientes distintos não se afetam |
| `TRUST_PROXY_HOPS=1`, XFF inválido (`10.3.3.N, nao-e-ip`) | 60× 200, 10× 429 → **cai para o IP do socket** |

### O que foi implementado

- Chave do rate limit = `req.socket.remoteAddress` por padrão. O `x-forwarded-for` só é considerado com `TRUST_PROXY_HOPS > 0`, lendo a **N-ésima entrada contando da direita** (as da direita são anexadas pela infraestrutura confiável, as da esquerda o cliente forja).
- A entrada escolhida tem de ser um **IP válido** (`net.isIP`), aceitando `ip:porta`; qualquer outra coisa cai para o IP do socket.
- **GC do Map:** `setInterval` de 60 s com `.unref()` removendo entradas expiradas.
- **Teto de 10.000 chaves:** ao estourar, descarta as mais antigas (o `Map` preserva a ordem de inserção). Antes o mapa crescia para sempre com chaves únicas — era um caminho de esgotar memória.
- `render.yaml` com `TRUST_PROXY_HOPS: "1"` e o README explicando como confirmar o valor (sintoma de valor alto demais: todos tomam 429 junto; baixo demais: ninguém toma).

---

## 4. Testes reais (`node:test`, sem dependências)

`test-security.mjs` foi **deletado** e substituído por `tests/`:

| Arquivo | Conteúdo |
| --- | --- |
| `tests/helpers.mjs` | sobe o servidor MCP de verdade (`--http`, porta livre) + servidor de fixture local; utilitários de tabela/bloco de código |
| `tests/parser.test.mjs` | 12 testes: `<` solto, `<` no fim, indentação Python e YAML, tabela com/sem `th`, escape de `\|`, colunas consistentes, colspan/`<br>`, entidades acentuadas/numéricas/desconhecidas/fora de range |
| `tests/security.test.mjs` | 13 testes: 15 faixas privadas, guarda nos 5 caminhos de saída, escape hatch, redirect normal, limite de 5 saltos, protocolo não suportado, redirect público→IP interno, rate limit sob 4 configurações de `TRUST_PROXY_HOPS`, 401 sem token |
| `tests/integration.test.mjs` | 4 testes na web pública (https, redirect http→https, tabelas em página real, sitemap). **Pulam sozinhos sem internet** |

`ALLOW_PRIVATE_HOSTS=1` é usado **só** nos testes que precisam do fixture local; os testes de bloqueio rodam com ele desligado, como em produção. Os helpers forçam `ALLOW_PRIVATE_HOSTS: ""` e `TRUST_PROXY_HOPS: "0"` explicitamente, para não dependerem do ambiente de quem roda.

```
npm test  ->  # tests 29   # pass 29   # fail 0   (14 s)
```

`package.json`: `"test": "node --test tests/parser.test.mjs tests/security.test.mjs tests/integration.test.mjs"` e `"test:e2e": "node scripts/smoke-test.mjs"`.

> Usei a lista explícita de arquivos em vez de `node --test tests/` porque nesta versão do Node (22.22) um diretório passado como argumento posicional é tratado como arquivo (`MODULE_NOT_FOUND`), e glob `tests/**/*.test.mjs` só funciona do Node 21 para cima — a lista explícita funciona do 18 ao 22 e nos dois shells.

### Prova de que os testes não são vazios

Rodando a suíte contra o `server.js` **anterior** (via `TEST_SERVER_PATH`, um seam adicionado só nos helpers):

```
ℹ tests 25   ℹ pass 6   ℹ fail 19
```

Os 6 que passam são os que asseguram comportamento que já estava correto (numéricas já decodificavam, redirect normal já era seguido, 401 já funcionava) — ou seja, servem como trava contra regressão futura. **19 falham**, cobrindo exatamente cada bug corrigido. O `test-security.mjs` antigo passaria em 100% dos casos.

---

## 5. Validação final

**Smoke-test (as 6 ferramentas): 17/17 OK.**

```
Ferramentas: read_page, extract_links, read_multiple_pages, discover_urls, crawl_site, read_dynamic_page
  OK  tools/list retornou as 6 ferramentas
  OK  read_page leu example.com
  OK  read_page leu pagina complexa (Wikipedia)
  OK  extract_links encontrou links na Wikipedia
  OK  read_multiple_pages leu as 2 paginas
  OK  read_multiple_pages aceita 30 URLs          (25/30 OK em 1.4s)
  OK  rejeita 31 URLs com erro claro
  OK  discover_urls respondeu (sitemap ou fallback)
  OK  crawl_site executou o crawl
  OK  read_page rejeita URL invalida com isError
  OK  modo HTTP (Render) subiu e respondeu em /health
  OK  HTTP rejeita chamada sem token (401) / token errado (401)
  OK  HTTP initialize respondeu serverInfo
  OK  HTTP tools/list retornou 6 ferramentas
  OK  HTTP read_page funcionou
RESULTADO: todos os testes passaram.
```

**Web pública continua funcionando** (o princípio que governa tudo):

| Caso | Resultado |
| --- | --- |
| `https://example.com` | OK, 156 chars |
| `http://github.com/` (redirect http→https) | OK, seguiu e leu |
| `http://pt.wikipedia.org/wiki/Node.js` (redirect http→https) | OK, 30993 chars |
| `https://pt.wikipedia.org/wiki/Brasil` | OK, tabela válida |
| cadeia de 2 redirects (`httpbin.org/redirect/2`) | chegou no destino (JSON → recusado por `ensureHtml`, comportamento correto) |
| cadeia de 9 redirects | recusado: "Redirects em excesso (mais de 5 saltos)" |

Nenhuma allowlist de domínio foi criada. A capacidade de ler a web pública está intacta.

---

## O que ficou de fora (não mexi, conforme combinado)

Itens da revisão que **não** estavam na sua lista de tarefas e continuam iguais:

1. **`tryInternalApi` sem teto de candidatos** (`server.js:1088+`): ainda dispara uma requisição sequencial por string `/api/...` encontrada no HTML, com timeout de 25 s cada. Agora as requisições passam pela guarda SSRF, mas o volume continua ilimitado. *(revisão I3)*
2. **Cache sem teto em bytes** (`server.js:845-862`): ainda 100 entradas × até 10 MB ≈ 1 GB potencial. *(I1)*
3. **`read_dynamic_page` duplica o cabeçalho** (`server.js:1150-1163`): o bug continua. *(I2)*
4. **`extract_links` ignora `<nav>`/`<header>`/`<footer>`** por usar o mesmo `SKIP_TAGS` do markdown. *(I7)*
5. **`readBody`**: corpo > 2 MB ainda devolve `400 Parse error` em vez de `413`, e ainda escreve na resposta depois de `req.destroy()`. *(I6)*
6. **Transporte HTTP fora da spec do MCP**: sem `Mcp-Session-Id`, `GET /mcp` → 405 (sem SSE). *(I4)*
7. **Sem `robots.txt`** em `crawl_site`/`discover_urls`; retry de 429 ignora `Retry-After`; retenta 401/403. *(I8)*
8. **README desatualizado** (fora da parte que eu documentei): seção inteira de Playwright que não existe no código, "truncado em 5000 caracteres" (é 8000), versão 1.0.0 (é 1.1.0), e a árvore lista 3 dos 11 scripts. Só acrescentei `tests/` na árvore.
9. **Sem `.gitignore`**; `server.err`, `server.log` e `scripts/test-youtube.mjs` estão soltos na raiz (untracked, não commitados).
10. **Versão divergente**: `package.json` 1.0.0 × `SERVER_VERSION` 1.1.0.
11. **`uncaughtException` não encerra o processo**; sem handler de SIGTERM.
12. **Comparação do token não é constant-time** (`server.js:1773`).
13. **`openStack` em `htmlToMarkdown` é código morto** — mantive de propósito para não inflar o diff.
14. **`published.slice(0, 25)`** trunca data de forma arbitrária.

## Problemas novos que eu notei e não estavam na revisão

1. **Bypass por IPv4 mapeado em IPv6** (`http://[::ffff:127.0.0.1]:porta/`): vazava igual ao loopback puro. **Corrigido** como parte do item 1 (o IPv4 embutido é validado). Mesma classe: NAT64 e 6to4.
2. **`crawl_site` reporta host bloqueado como conteúdo, não como erro** — "0 paginas lidas", com a mensagem no corpo. É consequência do isolamento de erro por URL que já existia no `crawl_site`; mantive por consistência, mas a IA precisa parsear texto para saber que falhou.
3. **Tags inline órfãs vazam marcadores**: `a <b` sem `</b>` produz um `**` aberto que nunca fecha. Pré-existente, fora do escopo.
4. **A máscara de blocos cercados** pode parear cercas errado se o texto da página contiver ` ``` ` literal em quantidade ímpar (caso raro, documentado no código).

---

## Resumo do que mudou, por arquivo

| Arquivo | Mudança |
| --- | --- |
| `server.js` | +363 linhas: guarda SSRF, `fetchNoRedirect`, `cleanMarkdown` com máscara, tabelas GFM, entidades Latin-1, `clientIpOf`, GC e teto do rate limit |
| `tests/helpers.mjs` | novo — infraestrutura dos testes |
| `tests/parser.test.mjs` | novo — 12 testes de parser |
| `tests/security.test.mjs` | novo — 13 testes de SSRF e rate limit |
| `tests/integration.test.mjs` | novo — 4 testes na web pública (pulam sem internet) |
| `test-security.mjs` | **removido** (só fazia grep no código-fonte) |
| `package.json` | `test` → `node --test tests/...`; `test:e2e` → smoke-test |
| `render.yaml` | comentário sobre `ALLOW_PRIVATE_HOSTS` + `TRUST_PROXY_HOPS: "1"` |
| `README.md` | seções novas: proteção SSRF, variáveis de ambiente, rate limit/`x-forwarded-for`, testes |
