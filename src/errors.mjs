/**
 * errors.mjs — um tipo de erro para cada coisa que pode dar errado.
 *
 * O QUE É
 *   Cada falha possível tem uma classe própria (HostBloqueadoError,
 *   TimeoutError, RobotsBloqueadoError, ParametroInvalidoError...) com um
 *   `code` estável e o contexto que importa (URL, host, causa original).
 *
 *   Por que não um `new Error("...")` só: quem chama precisa DECIDIR o que
 *   fazer. Com tipo, a decisão é `instanceof`; sem tipo, sobra comparar
 *   pedaço de mensagem — que quebra na primeira vez que o texto mudar.
 *
 * O QUE ENTRA / O QUE SAI
 *   Entra: uma mensagem legível e um objeto de opções (code, url, host, cause).
 *   Sai:   um erro tipado, pronto para virar resposta MCP com isError.
 *
 * QUEM USA
 *   Usado por: fetch, http-transport, net, security, tools, utils, video.
 */

export class WebReaderError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "WebReaderError";
    this.code = options.code || "UNKNOWN_ERROR";
    this.url = options.url || null;
    this.host = options.host || null;
    this.retryAfterMs = options.retryAfterMs || null;
    this.cause = options.cause || null;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class UrlInvalidaError extends WebReaderError {
  constructor(url, motivo = "formato inválido") {
    super(`URL inválida: ${url} (${motivo})`, { code: "URL_INVALIDA", url });
    this.name = "UrlInvalidaError";
  }
}

export class ProtocoloNaoSuportadoError extends WebReaderError {
  constructor(protocolo, url) {
    super(`Protocolo não suportado (${protocolo}). Use http/https.`, {
      code: "PROTOCOLO_NAO_SUPORTADO",
      url,
    });
    this.name = "ProtocoloNaoSuportadoError";
  }
}

export class HostBloqueadoError extends WebReaderError {
  constructor(host, endereco) {
    super(`Host bloqueado: endereço privado/interno (${endereco})`, {
      code: "HOST_BLOQUEADO",
      host,
    });
    this.name = "HostBloqueadoError";
  }
}

export class HostNaoResolvidoError extends WebReaderError {
  constructor(host) {
    super(`Não foi possível resolver o host: ${host}`, {
      code: "HOST_NAO_RESOLVIDO",
      host,
    });
    this.name = "HostNaoResolvidoError";
  }
}

export class RedirectError extends WebReaderError {
  constructor(motivo, url) {
    super(`Redirect inválido: ${motivo}`, { code: "REDIRECT_ERRO", url });
    this.name = "RedirectError";
  }
}

export class HttpError extends WebReaderError {
  constructor(status, statusText, url, retryAfterMs = null) {
    super(`HTTP ${status} ${statusText} ao acessar ${url}`, {
      code: `HTTP_${status}`,
      url,
      retryAfterMs,
    });
    this.name = "HttpError";
    this.status = status;
    this.statusText = statusText;
  }
}

export class ConteudoNaoHtmlError extends WebReaderError {
  constructor(contentType, url) {
    super(
      contentType
        ? `O conteúdo retornado não é HTML (content-type: ${contentType})`
        : "A resposta não parece ser HTML.",
      { code: "CONTEUDO_NAO_HTML", url }
    );
    this.name = "ConteudoNaoHtmlError";
    this.contentType = contentType;
  }
}

export class RespostaMuitoGrandeError extends WebReaderError {
  constructor(maxBytes, url) {
    super(`Resposta muito grande (acima de ${maxBytes} bytes).`, {
      code: "RESPOSTA_MUITO_GRANDE",
      url,
    });
    this.name = "RespostaMuitoGrandeError";
    this.maxBytes = maxBytes;
  }
}

export class RedeError extends WebReaderError {
  constructor(mensagem, url, causa = null) {
    super(mensagem, { code: "REDE_ERRO", url, cause: causa });
    this.name = "RedeError";
  }
}

export class TimeoutError extends WebReaderError {
  constructor(url, timeoutMs) {
    super(`Timeout após ${timeoutMs}ms ao acessar ${url}`, { code: "TIMEOUT", url });
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export class RequisicaoCanceladaError extends WebReaderError {
  constructor(motivo = "orçamento esgotado") {
    super(`Requisição cancelada (${motivo}).`, { code: "REQUISICAO_CANCELADA" });
    this.name = "RequisicaoCanceladaError";
  }
}

export class RobotsBloqueadoError extends WebReaderError {
  constructor(host, pathname, regra) {
    super(
      `Bloqueado por robots.txt de ${host}: o caminho ${pathname} casa com "Disallow: ${regra}". ` +
        `Defina ROBOTS_RESPECT=0 para ignorar o robots.txt.`,
      { code: "ROBOTS_BLOQUEADO", host }
    );
    this.name = "RobotsBloqueadoError";
    this.pathname = pathname;
    this.regra = regra;
  }
}

export class ParametroInvalidoError extends WebReaderError {
  constructor(parametro, motivo) {
    super(`Parâmetro inválido '${parametro}': ${motivo}`, { code: "PARAMETRO_INVALIDO" });
    this.name = "ParametroInvalidoError";
    this.parametro = parametro;
  }
}

export class LimiteExcedidoError extends WebReaderError {
  constructor(recurso, limite, recebido) {
    // A mensagem é lida por uma IA, e o smoke-test casa "Máximo de 30" (com
    // acento) nela: scripts/smoke-test.mjs:156. Mudar o texto é mudar o teste.
    super(
      `Limite excedido para ${recurso}: ${recebido} (Máximo de ${limite}). Divida em várias chamadas.`,
      { code: "LIMITE_EXCEDIDO" }
    );
    this.name = "LimiteExcedidoError";
    this.recurso = recurso;
    this.limite = limite;
    this.recebido = recebido;
  }
}

export class FerramentaDesconhecidaError extends WebReaderError {
  constructor(nome) {
    super(`Ferramenta desconhecida: ${nome}`, { code: "FERRAMENTA_DESCONHECIDA" });
    this.name = "FerramentaDesconhecidaError";
    this.nome = nome;
  }
}

export class ServidorOcupadoError extends WebReaderError {
  constructor(nome, ativos, fila) {
    super(
      `Servidor ocupado (${nome}): ${ativos} em andamento e ${fila} na fila. Tente de novo em instantes.`,
      { code: "SERVIDOR_OCUPADO" }
    );
    this.name = "ServidorOcupadoError";
    this.nome = nome;
    this.ativos = ativos;
    this.fila = fila;
  }
}

export class CorpoMuitoGrandeError extends WebReaderError {
  constructor(maxBytes) {
    super(`Corpo muito grande (máximo ${maxBytes} bytes).`, { code: "CORPO_MUITO_GRANDE" });
    this.name = "CorpoMuitoGrandeError";
    this.maxBytes = maxBytes;
    this.status = 413;
  }
}

export class CrawlError extends WebReaderError {
  constructor(url, causa) {
    super(`Não foi possível iniciar o crawl em ${url}: ${causa}`, {
      code: "CRAWL_ERRO",
      url,
    });
    this.name = "CrawlError";
  }
}
