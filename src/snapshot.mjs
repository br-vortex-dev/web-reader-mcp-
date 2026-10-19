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
 * - `force: true` grava a marca de agora sem comparar — é o "marque como
 *   lido", para o próximo diff medir a partir deste ponto.
 */

import { createHash } from "node:crypto";
import { CacheLRU } from "./utils.mjs";
import { chaveCanonica } from "./utils.mjs";
import { clampTimeoutMs } from "./fetch.mjs";

// Marcas por URL. TTL generoso (6 h) porque "o que mudou desde ontem" é um uso
// legítimo; teto de entradas baixo (500) porque cada marca é pequena mas
// infinita em cardinalidade — uma varredura grande não pode inflar a memória.
const TTL_SNAPSHOT_MS = 6 * 60 * 60 * 1000;
const MAX_SNAPSHOTS = 500;

export const snapshots = new CacheLRU({
  ttlMs: TTL_SNAPSHOT_MS,
  maxEntries: MAX_SNAPSHOTS,
  maxBytes: 8 * 1024 * 1024, // ~8 MB de hashes + resumos
});

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

/**
 * Diff por LINHAS (algoritmo de LCS por bloco). Não é o diff mínimo do git:
 * é a lista de linhas acrescentadas/removidas, que é o que se lê.
 * Custa O(n·m) no pior caso — por isso há teto de linhas e um corte barato
 * por prefixo/sufixo comum, que resolve o caso real (página que ganhou um
 * parágrafo no meio).
 */
export function diffDeLinhas(antes, depois, { maxLinhas = 4000 } = {}) {
  const a = normalizarParaDiff(antes).split("\n");
  const b = normalizarParaDiff(depois).split("\n");

  if (a.length > maxLinhas || b.length > maxLinhas) {
    // Página grande demais para LCS: responde o que dá para afirmar com o
    // hash e os tamanhos, sem inventar diff.
    return { grande: true, adicionadas: [], removidas: [], iguais: a.length === b.length };
  }

  // Corte do prefixo e do sufixo comuns: o miolo é o que interessa.
  let ini = 0;
  while (ini < a.length && ini < b.length && a[ini] === b[ini]) ini++;
  let fimA = a.length - 1;
  let fimB = b.length - 1;
  while (fimA >= ini && fimB >= ini && a[fimA] === b[fimB]) {
    fimA--;
    fimB--;
  }
  const meioA = a.slice(ini, fimA + 1);
  const meioB = b.slice(ini, fimB + 1);

  if (meioA.length === 0 && meioB.length === 0) {
    return { grande: false, adicionadas: [], removidas: [], iguais: true };
  }

  // LCS no miolo (que já é pequeno na prática).
  const n = meioA.length;
  const m = meioB.length;
  const tabela = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      tabela[i][j] =
        meioA[i] === meioB[j] ? tabela[i + 1][j + 1] + 1 : Math.max(tabela[i + 1][j], tabela[i][j + 1]);
    }
  }

  const removidas = [];
  const adicionadas = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (meioA[i] === meioB[j]) {
      i++;
      j++;
    } else if (tabela[i + 1][j] >= tabela[i][j + 1]) {
      removidas.push(meioA[i]);
      i++;
    } else {
      adicionadas.push(meioB[j]);
      j++;
    }
  }
  while (i < n) removidas.push(meioA[i++]);
  while (j < m) adicionadas.push(meioB[j++]);

  return { grande: false, adicionadas, removidas, iguais: adicionadas.length === 0 && removidas.length === 0 };
}

/** Monta a saída em markdown do diff_page. */
export function formatarSaidaDiff({ finalUrl, primeiraVez, gravado, diff, hashAntes, hashDepois, maxChars }) {
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
    linhas.push(
      "A pagina e grande demais para diff linha a linha; o hash prova que o conteudo mudou. " +
        "Use read_page ou find_on_page para ver o trecho que interessa."
    );
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

/** Conveniência para testes e para o /health. */
export function estatisticasSnapshot() {
  return snapshots.stats();
}

export { clampTimeoutMs };
