# Relatório — bateria de caos (tentativa de quebrar o web-reader-mcp)

Data: rodada local, Windows 10, Node 24.
Alvo: servidor real (`server.js --http`), não mock.
Artefatos: `dev/caos/` (fixture maliciosa + 6 scripts de ataque/prova).

## Resultado geral

| Etapa | Casos | Ok | Falhas |
|---|---|---|---|
| `npm test` (suíte de regressão) | 242 | 241 | 0 (1 pulado: SIGTERM no Windows) |
| Bateria de caos | 112 | 100 | 12 (7 eram do teste, não do servidor) |

O que **sobreviveu** (e está bem feito):

- SSRF: 21 pegadinhas — IP decimal/hex/octal, `[::ffff:127.0.0.1]`, `0.0.0.0`,
  `localtest.me`, `file://`, `gopher://`, `dict://`, `data:`, `javascript:`,
  credencial na URL. Todas bloqueadas **com a guarda ligada** (config de produção),
  e a guarda vale nas 10 ferramentas, não só no `read_page`.
- Protocolo: JSON truncado/vazio/null, id objeto/array, method numérico, params
  string, batch de 2000, corpo de 6 MB (413), 200 clientes que morrem no meio do
  corpo, PUT/PATCH/DELETE recusados. Nada derrubou o processo.
- ReDoS: `(a+)+$` e regex aninhada em `find_on_page` — 22 ms e 38 ms.
- Lixo no conteúdo: bomba gzip (200 MB), 25 MB de HTML, 200 mil `div` aninhadas,
  tabela 2000×200, billion laughs de XML, JSON de 100 mil níveis, UTF-8 inválido,
  NUL, 5 mil cabeçalhos, sitemap de 50 mil URLs. Todas com erro claro ou leitura
  truncada, sem queda.
- Penduradas: servidor de 60 s, corpo que nunca termina, pinga 1 byte/s, redirect
  infinito, 429 eterno — todas desistem no prazo.
- Inundação: 800 pedidos simultâneos na mesma URL (coalescing funcionou, 800/800),
  20 páginas de 25 MB em paralelo, 30 bombas gzip simultâneas. `/health` nunca foi
  recusado.

## Achados reais

### 1. GRAVE — bomba brotli trava o servidor inteiro (event loop bloqueado)

Um corpo `content-encoding: br` de **250 bytes no fio** descomprime em 150 MB.
Durante a descompressão o processo **para de atender tudo** — não é só a requisição
travada, o servidor fica surdo:

| Descomprimido | Bytes no fio | Parede | Loop travado |
|---|---|---|---|
| 50 MB | 93 B | 11,5 s | 11,5 s |
| 100 MB | 172 B | 24,6 s | 24,6 s |
| 150 MB | 250 B | 35,7 s | 35,7 s |
| 300 MB | 500 B | 71,9 s | 71,9 s |

Prova do "surdo": com uma sonda batendo no `/health` a cada 200 ms durante o ataque,
a maior janela sem resposta foi de **34,8 s** — exatamente o tempo da bomba.

Agrava dois pontos:

- O `timeoutMs` (padrão 8000, ou 3000 pedidos pelo cliente) **não interrompe**:
  150 MB com `timeoutMs=8000` levou 33,7 s; com `timeoutMs=3000`, 35,7 s. O teto é
  decorativo nesse caminho.
- O teto de resposta (`MAX_RESPONSE_BYTES`, 5 MB) também não vale durante a
  descompressão: ele só é conferido quando o pedaço chega, e o pedaço só chega
  depois que o brotli terminou de descomprimir o bloco.

Onde está: **`src/fetch.mjs`**. Isolando as camadas com o mesmo veneno:

| Camada | Tempo | Loop travado |
|---|---|---|
| `net.mjs` (`desembrulhar` + `coletarComTeto`, chamado direto) | 299 ms | 59 ms |
| `fetch.mjs` (`fetchText`) | 33 749 ms | 33 746 ms |
| servidor MCP completo | 34 757 ms | 34 775 ms |

Ou seja: `net.mjs` está correto; o defeito entra no caminho do `fetch.mjs`
(especificamente onde `lerCorpoComOrcamento` → `coletarComTeto` recebe o stream já
desembrulhado e o abort do `AbortController` não derruba o filtro em andamento:
`normalizarErroDeLeitura` só olha `signal.aborted` **depois** que a leitura termina).

Impacto: uma única requisição maliciosa derruba a disponibilidade de todo mundo que
usa o MCP. Não vaza memória nem mata o processo, mas é negação de serviço trivial
(250 bytes). No Render, com uma instância, o serviço fica fora até a bomba acabar.

Correção sugerida (não aplicada — aguardando aprovação): abortar de verdade a
descompressão. `AbortController` + `filtro.destroy()` no evento `abort`, lendo o
`signal` dentro do `for await` do `coletarComTeto` (ou usar `stream.pipeline` com
o signal), e limitar a razão de compressão (bytes descomprimidos / bytes lidos)
durante a leitura.

### 2. MÉDIO — robots.txt grande transforma rajada em fila de minutos

`robotsPermite()` (`src/security.mjs:292`) refaz a varredura de **todas** as regras
para **cada** URL, e `robotsPadraoParaRegex()` chama `robotsRegexCache.clear()`
quando o cache passa de 2000 entradas (`src/security.mjs:293`). Com um robots.txt
grande, o cache nunca aquece: a mesma varredura recomeça do zero, 200 vezes.

Medido no servidor real (50 ou 200 URLs numa rajada, mesmo host):

| robots.txt | URLs | Parede | p50 |
|---|---|---|---|
| pequeno (`Allow: /`) | 50 | 878 ms | 710 ms |
| 20 mil regras | 50 | 24 816 ms | 24 693 ms |
| pequeno | 200 | 2 315 ms | 1 776 ms |
| 20 mil regras | 200 | 57 520 ms | 57 231 ms |

Isolando a causa (só o `clear()` do cache):

| Regras | Com o `clear()` | Sem o `clear()` |
|---|---|---|
| 5 000 | 19 554 ms | 1 858 ms |
| 20 000 | 82 115 ms | 8 871 ms |

Remover só a linha do `clear()` já dá **~10×**. O certo é memoizar por origem
(compilar as regras uma vez, quando o robots.txt é lido) em vez de recompilar a
cada URL.

### 3. Menores (comportamento, não quebra)

- `corpo null` (JSON-RPC) devolve **202** e não responde nada. Está dentro da
  spec (notificação não gera resposta), mas confunde cliente que espera corpo.
- `TRACE /mcp` faz o **cliente** falhar (`TypeError`), não o servidor — o Node não
  envia TRACE. Não é defeito.
- Token de 50 KB e `x-forwarded-for` de 20 KB devolvem **431** (cabeçalho grande
  demais). É a resposta correta do Node, não erro.
- Com `ALLOW_PRIVATE_HOSTS=1` (modo de teste) o SSRF fica liberado — inclusive o
  redirect para host interno entregou `SEGREDO-INTERNO-ALCANCADO`. É o esperado:
  a guarda está desligada de propósito. Com a config de produção, **todas** as 21
  tentativas foram bloqueadas. Vale só como lembrete: não subir com essa variável.

## Como reproduzir

```bash
node dev/caos/bateria-caos.mjs          # 112 casos de ataque
node dev/caos/_prova-achados.mjs        # prova o achado 1 e 2
node dev/caos/_curva-bomba.mjs          # curva tamanho × travamento (lento)
node dev/caos/_isola-net.mjs            # isola a camada culpada
node dev/caos/_timeout-vs-bomba.mjs     # timeout não interrompe a descompressão
```

## Veredito

O servidor é sólido no que a suíte cobre: protocolo, SSRF, parser, limites,
concorrência e honestidade das respostas passaram de tudo. O que ele **não**
aguenta é conteúdo comprimido hostil de um site qualquer — 250 bytes derrubam a
disponibilidade por dezenas de segundos — e robots.txt patológico, que multiplica
a latência por 27×.
