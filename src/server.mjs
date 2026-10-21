/**
 * server.mjs — o cérebro do MCP: recebe a mensagem, decide, responde.
 *
 * O QUE É
 *   O roteador JSON-RPC e o transporte stdio. É ele que entende `initialize`,
 *   `tools/list` e `tools/call`, e que devolve o erro certo quando a mensagem
 *   não faz sentido. A lógica de cada ferramenta NÃO está aqui: está em
 *   tools.mjs (e nos módulos que ele chama).
 *
 * O QUE ENTRA / O QUE SAI
 *   Entra: uma linha JSON-RPC (stdio) ou uma mensagem já lida (HTTP).
 *   Sai:   a resposta JSON-RPC — resultado ou erro, com id preservado.
 *
 * QUEM USA
 *   É o ponto de entrada, chamado por server.js. Usa http-transport.mjs
 *   (transporte HTTP), tool-schemas.mjs (catálogo) e tools.mjs (execução).
 */

import {
  SERVER_NAME,
  SERVER_VERSION,
  PROTOCOL_VERSIONS,
  STDIO_MAX_LINE_BYTES,
} from "./config.mjs";
import { TOOLS } from "./tool-schemas.mjs";
import {
  startHttp,
  registrarHandleMessage,
  encerrarPorErro,
} from "./http-transport.mjs";
import { callTool } from "./tools.mjs";

/**
 * Trata uma mensagem JSON-RPC do MCP.
 */
async function handleMessage(msg, send) {
  if (!msg || typeof msg !== "object" || typeof msg.method !== "string") {
    if (msg && msg.id !== undefined) {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32600, message: "Invalid Request" } });
    }
    return;
  }
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  const reply = (result) => send({ jsonrpc: "2.0", id, result });
  const fail = (code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

  try {
    switch (method) {
      case "initialize": {
        const requested = params && params.protocolVersion;
        reply({
          protocolVersion: PROTOCOL_VERSIONS.has(requested) ? requested : "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          instructions:
            "Para pesquisar: use extract_links para descobrir URLs em páginas conhecidas, " +
            "depois use read_page para ler o conteúdo. Não existe ferramenta de busca — " +
            "as URLs vêm de você.",
        });
        return;
      }
      case "ping":
        if (isRequest) reply({});
        return;
      case "tools/list":
        if (isRequest) reply({ tools: TOOLS });
        return;
      case "tools/call": {
        if (!isRequest) return;
        const name = params && params.name;
        const args = (params && params.arguments) || {};
        try {
          const text = await callTool(String(name), args);
          reply({ content: [{ type: "text", text: String(text) }] });
        } catch (err) {
          reply({
            content: [{ type: "text", text: `Erro: ${err && err.message ? err.message : String(err)}` }],
            isError: true,
          });
        }
        return;
      }
      case "resources/list":
        if (isRequest) reply({ resources: [] });
        return;
      case "prompts/list":
        if (isRequest) reply({ prompts: [] });
        return;
      case "roots/list":
        if (isRequest) reply({ roots: [] });
        return;
      case "logging/setLevel":
        if (isRequest) reply({});
        return;
      default:
        if (isRequest) fail(-32601, `Método não suportado: ${method}`);
        return;
    }
  } catch (err) {
    if (isRequest) {
      fail(-32603, `Erro interno: ${err && err.message ? err.message : String(err)}`);
    }
  }
}

// O transporte HTTP precisa do roteador; registramos sem import circular.
registrarHandleMessage(handleMessage);

/**
 * Inicia o servidor em modo stdio (JSON-RPC newline-delimited).
 */
export function startStdio() {
  let buffer = "";
  let descartandoLinha = false; // linha gigante em descarte: ignora até o \n
  const encerrarLinha = (motivo) => {
    process.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: motivo } }) + "\n"
    );
  };
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    // Teto do buffer: uma linha maior que isto estoura a memória do processo.
    // Em vez de crescer sem limite, descarta a linha inteira (até o \n) e
    // responde com Parse error — o cliente que inventar de mandar 1 GB numa
    // linha recebe erro, não derruba o servidor.
    if (descartandoLinha) {
      const fim = buffer.indexOf("\n");
      if (fim === -1) {
        buffer = "";
        return;
      }
      buffer = buffer.slice(fim + 1);
      descartandoLinha = false;
    }
    if (buffer.length > STDIO_MAX_LINE_BYTES && buffer.indexOf("\n") === -1) {
      buffer = "";
      descartandoLinha = true;
      encerrarLinha("Parse error");
      return;
    }
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      if (line.length > STDIO_MAX_LINE_BYTES) {
        encerrarLinha("Parse error");
        continue;
      }
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        encerrarLinha("Parse error");
        continue;
      }
      handleMessage(msg, (message) => process.stdout.write(JSON.stringify(message) + "\n")).catch((err) => {
        console.error(`[${SERVER_NAME}] falha ao tratar mensagem:`, err);
        if (msg && msg.id !== undefined && msg.id !== null) {
          process.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              error: {
                code: -32603,
                message: `Erro interno: ${err && err.message ? err.message : String(err)}`,
              },
            }) + "\n"
          );
        }
      });
    }
  });
  process.stdin.on("end", () => process.exit(0));
  process.stdin.on("error", () => process.exit(0));
  console.error(`[${SERVER_NAME}] v${SERVER_VERSION} no ar - modo stdio`);
}

export { startHttp, encerrarPorErro };
