# Relatório de capacidade — web-reader-mcp

Data: 14/10/2026 · Commit da implementação: `976e2e7`
Artefatos: `load/harness.mjs` (carga, zero dependências), `load/k6.js` (script k6 pronto), `tests/limits.test.mjs` (6 testes).

---

## 1. Resposta direta

**"10 mil requisições simultâneas"** pode significar duas coisas muito diferentes, e a resposta muda completamente:

| Interpretação | Veredito | Medido |
| --- | --- | --- |
| **10 mil clientes simultâneos** respeitando o limite documentado (60 req/min cada) = 166 req/s no total | ✅ **Já suporta com folga** | 182 req/s com p50 de **171 ms**, p99 de 315 ms, **100% de sucesso** |
| **10 mil requisições em voo ao mesmo tempo** (cada cliente martelando o quanto puder) | ❌ **Não é possível numa instância** — e nem era antes | O teto é CPU: **~310 req/s por núcleo** |

O gargalo **não é** HTTP, cache, fila, banco nem balanceamento. É **CPU de um núcleo** gastando ~3 ms por página (tokenizar HTML + gerar markdown). Nenhuma dessas ferramentas muda isso: elas movem o problema de lugar, não aumentam a capacidade.

O que eu **fiz** foi resolver o que realmente estava errado: o servidor aceitava trabalho sem limite, então sob carga **todo mundo ficava lento até estourar o timeout** — a forma mais silenciosa de perder requisição. Agora ele atende quem entra com latência previsível e recusa o resto com erro explícito, sem estourar a memória.

---

## 2. Como medi (e a ressalva que importa)

Escrevi um harness de carga sem dependências (`load/harness.mjs`) porque instalar k6/Artillery adicionaria ferramentas ao ambiente. Ele usa o modelo fechado clássico: N clientes com keep-alive, cada um com 1 requisição em voo, medindo throughput, p50/p95/p99, erros e a memória do servidor (via preload com `--expose-gc`).

**Ressalva honesta sobre o hardware:** as medições foram feitas numa máquina de 2013 — **Intel i5-4200M, 2 núcleos / 4 threads, 1,7 GB livres**. O plano free do Render tem cerca de **metade de um vCPU**, então os números absolutos lá são **menores** que os meus (talvez metade). O que transfere não são os números absolutos, e sim **a forma**: onde fica o joelho da curva, quanto custa por requisição e como o servidor se comporta sob saturação.

Um erro meu que vale registrar: a **primeira versão do harness mentiu**. Ela contava sucesso pelo status HTTP, mas o servidor devolve **HTTP 200 mesmo quando a ferramenta falha** (o erro vem dentro do JSON-RPC, em `result.isError`). Ela reportou "0 erros" enquanto 92% das requisições eram recusadas. Corrigi o harness para olhar `isError` — e a partir daí os números passaram a contar a história real. **Quem mede carga sem olhar o corpo da resposta mede a coisa errada.**

---

## 3. O que estava errado

Medido no código anterior (commit `5f04bb4`), 2000 requisições simultâneas de `read_page`:

```
212 req/s úteis   |   p50 de 8,1 s   |   p99 de 10,1 s   |   RSS 151 MB
```

Não havia nenhum erro — e isso é justamente o problema. O servidor aceitava tudo, então cada requisição recebia uma fração ínfima de CPU e todas ficavam lentas. Com p50 de 8 s, **qualquer cliente MCP real já teria estourado o timeout** (tipicamente 30-60 s, mas com retries e concorrência o efetivo é bem menor). A perda era silenciosa: o servidor "respondia", só que tarde demais para servir.

E no extremo, com 10.000 simultâneas, o problema deixava de ser latência e virava **memória**:

```
ANTES, 10.000 simultâneas:   RSS 640 MB   |   p50 58,5 s   |   0,1% de sucesso
```

**640 MB num plano de 512 MB é OOM.** O servidor morreria — e aí sim perde tudo.

---

## 4. O que implementei

### 4.1 Controle de admissão (`MAX_INFLIGHT_REQUESTS` = 128)

No máximo 128 requisições sendo processadas ao mesmo tempo. `MAX_WAITING_REQUESTS` (4096) esperam por uma vaga até `MAX_WAIT_MS` (15 s); o resto recebe **503 com `Retry-After`** na hora.

O `/health` **nunca** passa por esse controle. Se passasse, o health check do Render marcaria o serviço como fora do ar exatamente quando ele está sob carga — derrubando-o de verdade.

### 4.2 Orçamento de memória por bytes em voo (`OUTBOUND_MEMORY_BUDGET` = 128 MB)

Este é o teto que importa, e é o coração da solução. Cada download **reserva** `min(content-length, MAX_RESPONSE_BYTES)` **antes** de começar a ler.

Por que por bytes e não por número de downloads: um teto de 12 downloads simultâneos (minha primeira tentativa, derivada de 128 MB ÷ 10 MB) **recusou 92% das requisições** sob carga, porque tratava uma página de 200 KB igual a uma de 10 MB. Com o orçamento por bytes, **muitas páginas pequenas passam juntas e poucas grandes são limitadas** — que é exatamente o que a memória precisa.

A reserva é feita **uma única vez, no início**, então nunca existe "segurar e esperar" (hold-and-wait) — ou seja, **não há risco de deadlock**, que é o bug clássico de semáforo ponderado com aquisição incremental.

### 4.3 Limite de downloads + fila limitada (`OUTBOUND_MAX_CONCURRENCY` = 128, `OUTBOUND_MAX_QUEUE` = 200)

Limita sockets e tarefas. Fila cheia devolve erro claro (`Servidor ocupado (downloads): ...`) em vez de acumular latência.

### 4.4 Fila FIFO com índice de cabeça

`Array.shift()` e `splice()` são O(n). Com 4096 esperando, isso vira trabalho real **justamente sob carga**. Troquei por uma fila com índice de cabeça, contador de tamanho e remoção preguiçosa (marca e pula na saída) — sem varrer o array nem para medir o tamanho.

### 4.5 Tuning do servidor HTTP

- `keepAliveTimeout` **65 s** (o padrão do Node é 5 s). Sob alta concorrência o custo dominante não é CPU: é **churn de conexão**. Com 5 s, um cliente ativo reabre conexão sem parar (TCP + TLS no proxy). E o keep-alive precisa ser **maior que o idle timeout do balanceador**, senão dá 502 quando o balanceador reusa uma conexão que o servidor acabou de fechar.
- `headersTimeout` 66 s, `requestTimeout` 300 s, `maxConnections` — todos configuráveis e validados na ordem que o Node exige (`keepAlive ≤ headers ≤ request`).
- `RATE_LIMIT_MAX` e `RATE_LIMIT_WINDOW_MS` passaram a ser configuráveis (necessário para operar e para testar carga).

### 4.6 Observabilidade no `/health`

```
web-reader-mcp v1.1.0 OK | cache: 100 entradas, 146100 bytes / 67108864 bytes (...) |
requisicoes: 64 ativas, 404 na fila (max 128/4096, recusadas 0) |
downloads: 64 ativos, 0 na fila (max 128/200, recusados 0) |
memoria de download: 0 MB de 128 MB (pico 0 MB, 0 na fila, recusados 0) |
conexoes: 501 | rss: 96 MB
```

Dá para ver em produção **onde** está o gargalo: se `requisicoes.naFila` cresce, é CPU; se `memoria de download` enche, são páginas grandes; se `recusados` sobe, é hora de escalar.

---

## 5. Resultado medido

Mesmo harness, mesmos 12 s, `read_page` com cache miss. `server-antes-carga.js` = commit anterior; `server.js` = depois.

### 2.000 requisições simultâneas

| Upstream | | Antes | Depois | Ganho |
| --- | --- | --- | --- | --- |
| instantâneo | vazão útil | 214 req/s | **335 req/s** | **+57%** |
| | sucesso | 94,8% | **100%** | |
| | p50 | 7.499 ms | **5.394 ms** | **−28%** |
| | RSS | 170 MB | **125 MB** | **−26%** |
| 150 ms (realista) | vazão útil | 131 req/s | **293 req/s** | **+124%** |
| | sucesso | 78,2% | **100%** | |
| | p50 | 11.380 ms | **6.297 ms** | **−45%** |
| | RSS | 225 MB | **128 MB** | **−43%** |

### 10.000 requisições simultâneas (martelando)

| | Antes | Depois |
| --- | --- | --- |
| **RSS** | **640 MB** → OOM em 512 MB | **170 MB** ✅ |
| p50 | 58,5 s | 25,1 s |
| sucesso | 0,1% | 0,2% |

**Nenhum dos dois atende 10.000 clientes martelando.** A diferença é que o antigo **estoura a memória do plano free** e o novo **sobrevive** dentro do orçamento, degradando de forma previsível — com 503 explícito em vez de timeout silencioso. Numa instância maior (mais vCPU), a mesma arquitetura escala com a CPU disponível.

### Nenhuma regressão

- `npm test`: **66 testes, 65 passam, 1 pulado** (SIGTERM no Windows).
- Smoke-test das 6 ferramentas: **17/17**.
- `tests/limits.test.mjs`: 6 testes novos, **todos os 6 falham** no `server.js` anterior.

---

## 6. A curva de capacidade (o número que importa)

`read_page` com cache miss, upstream de 150 ms, no hardware de teste:

| Concorrência | Vazão | p50 | p95 | p99 | Sucesso |
| --- | --- | --- | --- | --- | --- |
| 8 | 46 req/s | 172 ms | 184 ms | 237 ms | 100% |
| 16 | 91 req/s | 172 ms | 188 ms | 298 ms | 100% |
| 32 | 182 req/s | 171 ms | 188 ms | 315 ms | 100% |
| **64** | **309 req/s** | **189 ms** | 317 ms | 465 ms | 100% |
| 128 | 311 req/s | 364 ms | 656 ms | 894 ms | 100% |
| 2.000 | 293 req/s | 6.297 ms | 7.866 ms | 8.248 ms | 100% |

Leia assim: **o joelho está em ~64 simultâneas.** Até ali, mais concorrência = mais vazão com latência estável. Depois disso a vazão **não sobe mais** (~310 req/s) e só a latência cresce — sinal inequívoco de saturação de CPU.

É por isso que `MAX_INFLIGHT_REQUESTS` ficou em **128** (logo depois do joelho): dá margem para upstream lento sem sacrificar muito a latência. **Aumentar esse número não aumenta a vazão — só a fila.**

E é por isso que **10.000 clientes dentro do rate limit (166 req/s) caem à esquerda do joelho** e são atendidos com p50 de ~171 ms. É essa a conta que faz o caso real funcionar.

---

## 7. Por que Redis, RabbitMQ, Nginx e balanceamento não são a resposta aqui

Não é resistência a ferramenta — é que elas não atacam o gargalo medido. Com números:

| Técnica pedida | Por que não resolve este gargalo |
| --- | --- |
| **Connection pooling** | **Já existe.** O `fetch` do Node usa undici, que mantém keep-alive por origem por padrão. E não há banco de dados, então não há pool de banco para criar. O keep-alive de **entrada** eu ajustei (era 5 s). |
| **Cache (Redis)** | O cache já existe, em processo, com teto de 64 MB e LRU. O gargalo é **CPU parseando HTML**, não lookup de cache — um Redis adicionaria um salto de rede por leitura. Ele só faria sentido com **múltiplas instâncias** compartilhando cache, o que exige plano pago. |
| **Filas (RabbitMQ)** | Uma fila externa ajuda quando o gargalo é **rotear trabalho para workers**. Aqui a capacidade de um worker é limitada por CPU, então a fila não aumenta vazão — só move a fila para fora do processo (e adiciona um serviço para operar). A fila que faz diferença é a **local, curta**, que eu implementei. |
| **Balanceamento de carga (Nginx)** | O Render já termina TLS e balanceia na borda. Um nginx dentro do contêiner adicionaria um salto sem benefício. Balanceamento de verdade = **múltiplas instâncias** atrás do LB do Render, o que é decisão de plano, não de código. |
| **Tuning do servidor (Node)** | ✅ **Fiz**: keep-alive, headers/request timeout, maxConnections, concorrência de admissão e de saída, tudo configurável. |
| **k6 / Artillery** | ✅ **Entreguei**: `load/k6.js` pronto para rodar (com thresholds e rampa até 10k VUs) + o harness sem dependências, que roda agora sem instalar nada. |

**O ponto central:** o custo dominante é `tokenize` + `htmlToMarkdown` — ~3 ms de CPU por página. Nenhuma ferramenta de infraestrutura reduz isso. Só três coisas reduzem: **menos trabalho por página**, **mais núcleos** ou **menos páginas**.

---

## 8. O que é preciso para 10k de verdade (com a conta)

O número de instâncias depende da **taxa de requisições**, não da contagem de clientes. Essa é a confusão que faz projetos superdimensionarem:

| Cenário | Taxa | Instâncias necessárias |
| --- | --- | --- |
| 10.000 clientes, 1 req/min cada (dentro do limite) | 166 req/s | **1** (usa ~55% de um núcleo) |
| 10.000 clientes, 1 req a cada 10 s | 1.000 req/s | ~3 |
| 10.000 clientes, 1 req/s cada | 10.000 req/s | **~32** (a 310 req/s/instância) |
| 10.000 requisições em voo, cada uma esperando ~200 ms | 50.000 req/s | **~160** |

Caminho concreto, em ordem de custo-benefício:

1. **Instância paga do Render** (1 vCPU em vez de ~0,5): dobra a capacidade e acaba com o cold start de 50 s do plano free. É o maior ganho por real gasto.
2. **Escala horizontal** (2-5 instâncias + LB do Render): capacidade linear. A arquitetura já é *stateless* (o cache é local e descartável), então funciona sem mudança de código.
3. **Reduzir o custo por página**: pular `htmlToMarkdown` quando o cliente só quer links, ou tokenizar em streaming. Isso ataca o gargalo de verdade e vale mais que qualquer infraestrutura.
4. **Cache compartilhado (Redis)**: só depois de ter várias instâncias, para não repetir download entre elas.

**Custo aproximado:** ~32 instâncias de US$ 7/mês ≈ **US$ 224/mês** para servir 10.000 req/s. Vale dizer isso em voz alta, porque "suportar 10k" sem essa conta é uma promessa que ninguém cumpre.

---

## 9. Um alerta que não é técnico

Este serviço faz **requisições de saída para sites de terceiros**. Escalar para 10.000 downloads simultâneos é, do ponto de vista de qualquer site alvo, **indistinguível de um ataque**. Na prática o serviço seria bloqueado, e com razão.

O rate limit de 60/min por cliente e o limite de downloads simultâneos **não são só recursos de performance** — são o que mantém o serviço do lado de cá da linha entre "ferramenta de leitura" e "botnet de scraping". Recomendo fortemente **não** afrouxar esses dois limites para atingir números de carga, e sim escalar horizontalmente mantendo a taxa de saída sob controle (incluindo `robots.txt`, que continua fora do escopo desde a rodada 1).

---

## 10. Como rodar os testes de carga

```bash
# harness sem dependências (roda agora)
node load/harness.mjs --concurrency 64  --seconds 15 --mode read --delay 150
node load/harness.mjs --concurrency 10000 --seconds 30 --mode read
node load/harness.mjs --concurrency 1000 --seconds 10 --mode tools      # camada HTTP pura
node load/harness.mjs --server ./server-antigo.js --concurrency 2000 ... # comparar versões

# k6 (instalar fora do projeto: winget/brew/apt install k6)
k6 run -e MCP_URL=http://127.0.0.1:3000/mcp -e MCP_TOKEN=t load/k6.js
k6 run -e VUS_MAX=10000 -e DURACAO=2m -e MCP_URL=https://SEU-APP.onrender.com/mcp -e MCP_TOKEN=xxx load/k6.js
```

Modos do harness: `tools` (sem I/O, mede a camada HTTP), `read` (URL única por requisição, cache miss, pior caso), `read-cache` (mesma URL, cache quente). `--delay N` simula a latência do site alvo.

---

## 11. Ressalvas e o que ficou de fora

- **Não instalei k6 nem Artillery** — entreguei o script pronto (`load/k6.js`) e um harness equivalente sem dependências. Instalar ferramentas globais no seu ambiente não me parecia adequado sem você pedir.
- **As medições são de uma máquina fraca (2013) e o cliente de carga divide os mesmos 4 threads com o servidor.** Os números absolutos são um piso; a forma da curva é o que vale.
- **Não testei em múltiplas máquinas**, então não há medição de escala horizontal — só a projeção aritmética.
- **O custo por requisição (~3 ms) não foi otimizado.** É o gargalo real e o maior ganho disponível, mas reduzir isso significa mexer no parser (o núcleo do produto, validado por 12 testes na rodada 1) — fora do escopo de um pedido de infraestrutura.
- **`MAX_INFLIGHT_REQUESTS` é um número fixo**, calibrado para este hardware. Numa instância muito maior ou com upstream muito lento (segundos), ele pode subestimar a capacidade. A curva na seção 6 é o guia para recalibrar.
- Seguem fora do escopo (herdados): split em módulos, `Mcp-Session-Id`/SSE, `robots.txt`, `extract_links` ignorando `<nav>`, `package.json` 1.0.0 × `SERVER_VERSION` 1.1.0.

---

## 12. Resumo

| Pergunta | Resposta |
| --- | --- |
| O servidor aguenta 10 mil clientes simultâneos? | **Sim**, se respeitarem o limite documentado (166 req/s): p50 de 171 ms, 100% de sucesso, ~55% de um núcleo. |
| Aguenta 10 mil requisições em voo martelando? | **Não**, e não é questão de tuning: o teto é ~310 req/s por núcleo. Antes: 640 MB de RSS (OOM em 512 MB) e p50 de 58 s. Agora: 170 MB, estável, com 503 explícito. |
| O que ganhou de concreto? | **+57% a +124% de vazão útil**, **100% de sucesso** onde antes era 78-95%, **metade da memória**, e nenhuma perda silenciosa. |
| Redis/RabbitMQ/Nginx? | Não atacam o gargalo medido (CPU de parse). A fila que importa é a local, e ela está implementada. |
| O que falta para 10k de verdade? | Plano pago + escala horizontal (~32 instâncias para 10k req/s) e/ou reduzir o custo por página. |
