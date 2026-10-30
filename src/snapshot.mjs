/**
 * Snapshot e diff de página (diff_page).
 *
 * Por que existe: reler a mesma página para saber "o que mudou" era caro e
 * cego — a IA baixava a página inteira outra vez e comparava dois blocos de
 * 25.000 caracteres de olho. Aqui a primeira leitura vira uma MARCA (hash do
 * conteúdo convertido + resumo), e a seguinte devolve só o que mudou.
 *
 * Decisões que importam:
 * - A marca guarda o HASH e o texto NORMALIZADO curto, não a página inteira:
 *   guardar páginas em memória por horas é justamente o que o cache com TTL
 *   já evita. Sem o texto anterior, respondemos "mudou" com o que dá para
 *   afirmar; com ele (quando o chamador pede), o diff é linha a linha.
 * - Com SNAPSHOT_DIR, a marca também vai para disco. Sem isso, o restart do
 *   serviço (ou um segundo worker do WEB_CONCURRENCY) perdia o ponto de
 *   comparação e a segunda leitura respondia "PRIMEIRA leitura". O nome do
 *   ficheiro é o hash da chave, nunca a URL, para que nada no caminho venha
 *   da entrada. Escrita atómica (.tmp + rename) e falha de disco nunca derruba
 *   a ferramenta: ela degrada para o comportamento só-em-memória.
 * QUEM USA
 *   Usado por: tools.mjs (na ferramenta diff_page), http-transport.mjs (/health).
 *   Importa de: config, fetch, utils.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { CacheLRU } from "./utils.mjs";
import { chaveCanonica } from "./utils.mjs";
import { clampTimeoutMs } from "./fetch.mjs";
import { SNAPSHOT_DIR, SNAPSHOT_TTL_MS, SNAPSHOT_MAX_ENTRIES, SNAPSHOT_MAX_BYTES } from "./config.mjs";

// Marcas por URL. TTL generoso (6 h) porque "o que mudou desde ontem" é um uso
// legítimo; teto de entradas baixo (500) porque cada marca é pequena mas
// infinita em cardinalidade — uma varredura grande não pode inflar a memória.
// Os três números vêm do config (e são os mesmos do disco, para a poda caber).
export const snapshots = new CacheLRU({
  ttlMs: SNAPSHOT_TTL_MS,
  maxEntries: SNAPSHOT_MAX_ENTRIES,
  maxBytes: SNAPSHOT_MAX_BYTES, // ~8 MB de hashes + resumos
});

// Contadores para o /health. `lidasDoDisco` é o que prova que a persistência
// está a servir o caso real (leitura que não estava na memória desta instância).
export const gravacoes = { escritas: 0, falhas: 0, lidasDoDisco: 0, descartadas: 0 };

/** Teto do texto normalizado guardado numa marca (o hash é o resto). */
export const TEXTO_DA_MARCA = 64 * 1024;

let avisosDeDisco = 0;
let arquivosNoDisco = 0;
let dirPronto = false;
let seq = 0;
let filaDeEscritas = Promise.resolve();

/** Nome do ficheiro da marca: hash da chave, 32 hex. Nunca vem da URL. */
function nomeDaChave(chave) {
  return createHash("sha256").update(String(chave), "utf8").digest("hex").slice(0, 32);
}

function arquivoDaMarca(chave) {
  if (!SNAPSHOT_DIR) return null;
  return join(SNAPSHOT_DIR, `${nomeDaChave(chave)}.json`);
}

function avisar(err, oQue) {
  gravacoes.falhas++;
  if (avisosDeDisco++ < 3) {
    console.error(`[snapshot] falha ao ${oQue}: ${err && err.message ? err.message : err}`);
  }
}

/** Lê a marca do disco e devolve o payload (ou null se não há/expirou). */
function lerDoDisco(chave) {
  const arquivo = arquivoDaMarca(chave);
  if (!arquivo) return null;
  let obj;
  try {
    obj = JSON.parse(readFileSync(arquivo, "utf8"));
  } catch {
    return null; // sem ficheiro, ou ficheiro corrompido: é como se não houvesse marca
  }
  // JSON válido pode ser null/número/lista: acessar `.at` num null derrubava a
  // ferramenta inteira a partir de um ficheiro corrompido no diretório.
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const idade = Date.now() - Number(obj.at || 0);
  // A chave dentro do ficheiro tem que bater com a chave pedida: sem esta
  // conferência, um ficheiro trocado furaria a marca de uma URL para outra.
  if (obj.chave !== chave || typeof obj.hash !== "string" || idade >= SNAPSHOT_TTL_MS) {
    try {
      unlinkSync(arquivo);
      arquivosNoDisco = Math.max(0, arquivosNoDisco - 1);
      gravacoes.descartadas++;
    } catch {
      /* arquivo já se foi */
    }
    return null;
  }
  return { hash: obj.hash, texto: typeof obj.texto === "string" ? obj.texto : "", bytes: Number(obj.bytes) || 0 };
}

function escreverAtomico(arquivo, conteudo) {
  const tmp = `${arquivo}.${process.pid}.${++seq}.tmp`;
  writeFileSync(tmp, conteudo, "utf8");
  renameSync(tmp, arquivo);
}

/**
 * Grava a marca na memória e, com SNAPSHOT_DIR, em disco. As escritas passam
 * todas pela mesma fila: dois diffs da mesma URL não escrevem o ficheiro ao
 * mesmo tempo e a ordem das versões fica a ser a ordem das chamadas.
 */
export function guardarMarca(chave, payload, bytes) {
  snapshots.set(chave, payload, bytes);
  if (!SNAPSHOT_DIR) return Promise.resolve(false);
  const arquivo = arquivoDaMarca(chave);
  const corpo = JSON.stringify({ chave, ...payload, bytes, at: Date.now() });
  filaDeEscritas = filaDeEscritas.then(() => {
    try {
      if (!dirPronto) {
        mkdirSync(SNAPSHOT_DIR, { recursive: true });
        dirPronto = true;
      }
      escreverAtomico(arquivo, corpo);
      gravacoes.escritas++;
      arquivosNoDisco++;
      if (arquivosNoDisco > SNAPSHOT_MAX_ENTRIES) podar();
      return true;
    } catch (err) {
      avisar(err, "gravar marca");
      return false;
    }
  });
  return filaDeEscritas;
}

/** Espera as escritas pendentes. Usado no shutdown para não perder a última marca. */
export function esperarEscritasDeMarcas() {
  return filaDeEscritas;
}

/** Despeja o que expirou e, se ainda não cabe, as mais antigas. */
function podar() {
  const agora = Date.now();
  const marcas = [];
  for (const nome of readdirSync(SNAPSHOT_DIR)) {
    if (!nome.endsWith(".json")) continue;
    const caminho = join(SNAPSHOT_DIR, nome);
    let at = 0;
    try {
      const obj = JSON.parse(readFileSync(caminho, "utf8"));
      at = Number(obj.at) || statSync(caminho).mtimeMs;
    } catch {
      at = statSync(caminho).mtimeMs;
    }
    if (agora - at >= SNAPSHOT_TTL_MS) {
      try {
        unlinkSync(caminho);
        gravacoes.descartadas++;
        continue;
      } catch {
        /* segue */
      }
    }
    marcas.push({ caminho, at });
  }
  marcas.sort((a, b) => b.at - a.at);
  for (const m of marcas.slice(SNAPSHOT_MAX_ENTRIES)) {
    try {
      unlinkSync(m.caminho);
      gravacoes.descartadas++;
    } catch {
      /* fica para a próxima poda */
    }
  }
  arquivosNoDisco = Math.min(marcas.length, SNAPSHOT_MAX_ENTRIES);
}

/** Carrega as marcas do disco para a memória. Chamado uma vez no arranque. */
export function carregarSnapshotsDoDisco() {
  if (!SNAPSHOT_DIR) return 0;
  let nomes;
  try {
    nomes = readdirSync(SNAPSHOT_DIR).filter((n) => n.endsWith(".json"));
  } catch {
    return 0; // diretório ainda não existe: primeira execução, nada a carregar
  }
  const marcas = [];
  for (const nome of nomes) {
    let obj;
    try {
      obj = JSON.parse(readFileSync(join(SNAPSHOT_DIR, nome), "utf8"));
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue;
    // O nome tem que bater com o hash da chave declarada dentro: sem esta
    // conferência, um ficheiro editado à mão furaria uma marca para outra URL.
    if (typeof obj.chave !== "string" || nome !== `${nomeDaChave(obj.chave)}.json`) continue;
    const idade = Date.now() - Number(obj.at || 0);
    if (typeof obj.hash !== "string" || idade >= SNAPSHOT_TTL_MS) continue;
    marcas.push({
      chave: obj.chave,
      payload: { hash: obj.hash, texto: typeof obj.texto === "string" ? obj.texto : "" },
      bytes: Number(obj.bytes) || 0,
      at: Number(obj.at),
    });
  }
  // As mais recentes primeiro: se o disco tem mais do que o teto, as velhas
  // simplesmente não entram (e a poda das que expiraram acontece na escrita).
  marcas.sort((a, b) => b.at - a.at);
  let carregadas = 0;
  for (const m of marcas.slice(0, SNAPSHOT_MAX_ENTRIES)) {
    snapshots.set(m.chave, m.payload, m.bytes);
    carregadas++;
  }
  arquivosNoDisco = nomes.length;
  return carregadas;
}

/**
 * A marca da URL: memória primeiro, disco depois. O passe no disco é o que faz
 * um segundo worker (ou um processo recém-reiniciado) ver a marca que o outro
 * deixou, sem ter que recarregar o diretório inteiro.
 */export function buscarMarca(chave) {
  const naMemoria = snapshots.get(chave);
  if (naMemoria) return naMemoria.payload;
  const doDisco = lerDoDisco(chave);
  if (doDisco) {
    gravacoes.lidasDoDisco++;
    snapshots.set(chave, { hash: doDisco.hash, texto: doDisco.texto }, doDisco.bytes);
    return doDisco;
  }
  return null;
}

/** Hash estável do conteúdo convertido. */
export function hashConteudo(texto) {
  return createHash("sha256").update(String(texto || ""), "utf8").digest("hex").slice(0, 32);
}

/**
 * Normaliza o texto para comparação: espaços no fim das linhas e linhas
 * vazias repetidas não são "mudança de conteúdo" — são ruído de renderização.
 */
export function normalizarParaDiff(texto) {
  return String(texto || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Bytes que a marca realmente ocupa (hash + texto guardado). */
export function tamanhoDaMarca(payload) {
  return (
    Buffer.byteLength(payload.hash || "", "utf8") + Buffer.byteLength(payload.texto || "", "utf8")
  );
}

// Teto de células da tabela de LCS (~16 MB de Uint32Array). Acima disso, o
// diff vira "grande demais" em vez de arriscar derrubar o processo.
const MAX_CELULAS_LCS = 4_000_000;

/**
 * Diff por LINHAS (algoritmo de LCS por bloco). Não é o diff mínimo do git:
 * é a lista de linhas acrescentadas/removidas, que é o que se lê.
 * Custa O(n·m) no pior caso — por isso há teto de linhas e um corte barato
 * por prefixo/sufixo comum, que resolve o caso real (página que ganhou um
 * parágrafo no meio).
 */
export function diffDeLinhas(antes, depois, { maxLinhas = 4000 } = {}) {
  const linhasAntes = normalizarParaDiff(antes).split("\n");
  const linhasDepois = normalizarParaDiff(depois).split("\n");

  // Corte do prefixo e do sufixo comuns: o miolo é o que interessa.
  // `inicio` é a primeira linha em que os dois lados diferem; `fimAntes` e
  // `fimDepois` são as últimas que coincidem, uma para cada lado (elas podem
  // ser diferentes porque uma versão pode ter mais linhas no rabo).
  let inicio = 0;
  while (inicio < linhasAntes.length && inicio < linhasDepois.length && linhasAntes[inicio] === linhasDepois[inicio]) {
    inicio++;
  }
  let fimAntes = linhasAntes.length - 1;
  let fimDepois = linhasDepois.length - 1;
  while (fimAntes >= inicio && fimDepois >= inicio && linhasAntes[fimAntes] === linhasDepois[fimDepois]) {
    fimAntes--;
    fimDepois--;
  }
  const meioAntes = linhasAntes.slice(inicio, fimAntes + 1);
  const meioDepois = linhasDepois.slice(inicio, fimDepois + 1);

  if (meioAntes.length === 0 && meioDepois.length === 0) {
    return { grande: false, adicionadas: [], removidas: [], iguais: true };
  }

  const totalAntes = meioAntes.length;
  const totalDepois = meioDepois.length;
  // O teto por LINHAS não segura o custo do LCS sozinho: 4.000×4.000 células
  // são ~64 MB de Uint32Array. O produto é o orçamento real (~16 MB aqui).
  // A decisão vem DEPOIS do corte de prefixo/sufixo: uma página de 50 mil
  // linhas que mudou um parágrafo tem miolo de duas linhas e merece o diff —
  // antes, ela caía em "grande demais" sem tentar.
  if (totalAntes > maxLinhas || totalDepois > maxLinhas || totalAntes * totalDepois > MAX_CELULAS_LCS) {
    // Página grande demais para LCS: responde o que dá para afirmar com o
    // hash e os tamanhos, sem inventar diff. `iguais` é SEMPRE false aqui: o
    // código só chega neste ponto quando o corte de prefixo/sufixo encontrou
    // diferença real, e antes a comparação era "mesmo número de linhas", que
    // fazia uma troca de conteúdo com contagem igual sair como "SEM MUDANCA".
    return {
      grande: true,
      adicionadas: [],
      removidas: [],
      iguais: false,
    };
  }

  // LCS no miolo (que já é pequeno na prática).
  // `tabela[i][j]` guarda o tamanho do maior subsequência comum entre
  // meioAntes[i..] e meioDepois[j..]. É preenchida do fim para o começo
  // porque cada célula depende das de baixo e da direita.
  const tabela = Array.from({ length: totalAntes + 1 }, () => new Uint32Array(totalDepois + 1));
  for (let i = totalAntes - 1; i >= 0; i--) {
    for (let j = totalDepois - 1; j >= 0; j--) {
      tabela[i][j] =
        meioAntes[i] === meioDepois[j]
          ? tabela[i + 1][j + 1] + 1
          : Math.max(tabela[i + 1][j], tabela[i][j + 1]);
    }
  }

  const removidas = [];
  const adicionadas = [];
  let i = 0;
  let j = 0;
  while (i < totalAntes && j < totalDepois) {
    if (meioAntes[i] === meioDepois[j]) {
      i++;
      j++;
    } else if (tabela[i + 1][j] >= tabela[i][j + 1]) {
      removidas.push(meioAntes[i]);
      i++;
    } else {
      adicionadas.push(meioDepois[j]);
      j++;
    }
  }
  while (i < totalAntes) removidas.push(meioAntes[i++]);
  while (j < totalDepois) adicionadas.push(meioDepois[j++]);

  return { grande: false, adicionadas, removidas, iguais: adicionadas.length === 0 && removidas.length === 0 };
}

/** Monta a saída em markdown do diff_page. */
export function formatarSaidaDiff({
  finalUrl,
  primeiraVez,
  gravado,
  diff,
  hashAntes,
  hashDepois,
  maxChars,
  marcaTruncada = false,
}) {
  const linhas = [];
  linhas.push(`# Diff: ${finalUrl.split("/").pop() || finalUrl}`);
  linhas.push(`URL: ${finalUrl}`);

  if (primeiraVez) {
    linhas.push(`Estado: PRIMEIRA leitura — marca gravada agora`);
    linhas.push(`Hash: ${hashDepois}`);
    linhas.push("");
    linhas.push(
      "Nao havia marca anterior desta URL. A proxima chamada compara com este ponto " +
        "e devolve so o que mudou."
    );
    return linhas.join("\n");
  }

  if (!diff || diff.iguais) {
    linhas.push(`Estado: SEM MUDANCA desde a marca anterior`);
    linhas.push(`Hash: ${hashDepois}`);
    return linhas.join("\n");
  }

  if (diff.grande) {
    linhas.push(`Estado: MUDOU (hash diferente)`);
    linhas.push(`Hash antes: ${hashAntes}`);
    linhas.push(`Hash agora: ${hashDepois}`);
    linhas.push("");
    if (marcaTruncada) {
      linhas.push(
        "A marca guarda apenas os primeiros 64 KB de texto; a mudanca pode estar fora desse trecho. " +
          "Use read_page ou find_on_page para localiza-la."
      );
    } else {
      linhas.push(
        "A pagina e grande demais para diff linha a linha; o hash prova que o conteudo mudou. " +
          "Use read_page ou find_on_page para ver o trecho que interessa."
      );
    }
    return linhas.join("\n");
  }

  linhas.push(`Estado: MUDOU`);
  linhas.push(`Hash antes: ${hashAntes}`);
  linhas.push(`Hash agora: ${hashDepois}`);
  linhas.push(`Linhas: +${diff.adicionadas.length} / -${diff.removidas.length}`);
  if (gravado) linhas.push("(marca atualizada para este conteudo)");
  linhas.push("");

  if (diff.removidas.length > 0) {
    linhas.push("## Removido");
    for (const l of diff.removidas) linhas.push(`- ${l}`);
    linhas.push("");
  }
  if (diff.adicionadas.length > 0) {
    linhas.push("## Adicionado");
    for (const l of diff.adicionadas) linhas.push(`+ ${l}`);
    linhas.push("");
  }

  const texto = linhas.join("\n");
  if (texto.length <= maxChars) return texto;
  return (
    texto.slice(0, maxChars) +
    `\n\n[... diff truncado em ${maxChars} caracteres; as contagens acima sao do diff completo ...]`
  );
}

/** Chave da marca: URL canônica (mesma normalização do cache). */
export function chaveSnapshot(url) {
  return chaveCanonica(url);
}

/** Estatísticas para testes e para o /health. */
export function estatisticasSnapshot() {
  return { ...snapshots.stats(), persistencia: SNAPSHOT_DIR || null, gravacoes: { ...gravacoes } };
}

export { clampTimeoutMs };
