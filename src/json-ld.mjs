/**
 * json-ld.mjs — dados estruturados da página (application/ld+json).
 *
 * O QUE É
 *   Muitos sites publicam, num <script type="application/ld+json">, a mesma
 *   informação que mostram na tela: autor, data, perguntas frequentes, receita,
 *   avaliação. Ler esse bloco é mais confiável do que adivinhar pelo HTML e é
 *   a fonte que o Google usa. Aqui ficam as funções que encontram, achatam e
 *   interpretam esses objetos.
 *
 * O QUE ENTRA / O QUE SAI
 *   Entra: o HTML da página.
 *   Sai:   uma lista de objetos JSON-LD já sem os envelopes (`@graph`, arrays).
 *
 * QUEM USA
 *   Usado por: page-info.mjs e faq.mjs.
 */

/**
 * Um envelope é um objeto que só agrupa outros (`@graph`) ou uma marcação sem
 * tipo. Descer por ele evita que o consumidor precise saber a forma do site.
 */
function achatar(valor, saida) {
  if (Array.isArray(valor)) {
    for (const item of valor) achatar(item, saida);
    return;
  }
  if (!valor || typeof valor !== "object") return;
  if (Array.isArray(valor["@graph"])) {
    for (const item of valor["@graph"]) achatar(item, saida);
    // O nó externo normalmente é só o envelope; quando ele mesmo tem tipo,
    // também é um dado da página e não pode ser descartado.
    if (valor["@type"]) saida.push(valor);
    return;
  }
  saida.push(valor);
}

/**
 * Extrai os objetos JSON-LD do HTML.
 *
 * JSON quebrado é comum (vírgula sobrando, aspas soltas): um script inválido
 * não invalida a página, então ele é ignorado e os demais seguem valendo.
 */
export function extrairJsonLd(html) {
  const itens = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let achado;
  while ((achado = re.exec(html)) !== null) {
    try {
      achatar(JSON.parse(achado[1].trim()), itens);
    } catch {
      // script inválido: o próximo pode ser o bom
    }
  }
  return itens;
}

/** Tipos declarados por um objeto ("Article", ["Article", "NewsArticle"]). */
export function tiposDe(item) {
  const tipo = item && item["@type"];
  if (Array.isArray(tipo)) return tipo.filter((t) => typeof t === "string");
  return typeof tipo === "string" ? [tipo] : [];
}

/** Todos os tipos da página, sem repetição e na ordem em que aparecem. */
export function tiposDaPagina(itens) {
  const vistos = new Set();
  const tipos = [];
  for (const item of itens) {
    for (const tipo of tiposDe(item)) {
      const chave = tipo.toLowerCase();
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      tipos.push(tipo);
    }
  }
  return tipos;
}

/** Primeiro objeto do tipo pedido (comparação sem diferenciar maiúsculas). */
export function acharPorTipo(itens, tipo) {
  const alvo = String(tipo).toLowerCase();
  for (const item of itens) {
    if (tiposDe(item).some((t) => t.toLowerCase() === alvo)) return item;
  }
  return null;
}

/**
 * Texto legível de um campo que pode vir como string, número, lista, objeto
 * com `name` ou o formato `{"@value": "..."}`. Devolve "" quando não há nada.
 */
export function textoDe(valor) {
  if (typeof valor === "string") return valor.trim();
  if (typeof valor === "number") return String(valor);
  if (Array.isArray(valor)) {
    for (const item of valor) {
      const texto = textoDe(item);
      if (texto) return texto;
    }
    return "";
  }
  if (valor && typeof valor === "object") {
    for (const chave of ["name", "@value", "text", "headline"]) {
      const texto = textoDe(valor[chave]);
      if (texto) return texto;
    }
  }
  return "";
}

/** Autor de um objeto JSON-LD (pode ser um ou uma lista de pessoas). */
export function autorDe(item) {
  return textoDe(item && item.author);
}
