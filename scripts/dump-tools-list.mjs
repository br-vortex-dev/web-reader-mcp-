#!/usr/bin/env node
/**
 * dump-tools-list.mjs — gera o snapshot de tools/list (JSON exato do servidor).
 *
 * O `tools/list` do servidor devolve `{ tools: TOOLS }` sem transformação
 * (src/server.mjs), então o snapshot é gerado direto do catálogo — mesma saída,
 * sem subir servidor. A versão anterior abria um processo filho em HTTP e
 * matava com `process.exit` logo após o `kill`, o que aborta o libuv no
 * Windows ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)") e
 * derrubava o script DEPOIS de já ter gravado o arquivo.
 *
 * Uso: node scripts/dump-tools-list.mjs [caminho-de-saida]
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TOOLS } from "../src/tool-schemas.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const saida = process.argv[2] || join(__dirname, "..", "tests", "snapshot", "tools-list.json");

await writeFile(saida, JSON.stringify(TOOLS, null, 2) + "\n", "utf8");
console.log(`snapshot gravado em ${saida} (${TOOLS.length} ferramentas)`);
