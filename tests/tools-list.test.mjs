// tools/list tem de devolver EXATAMENTE o mesmo JSON de antes da separação dos
// módulos. O snapshot em tests/snapshot/tools-list.json foi gerado do servidor
// em funcionamento (node scripts/dump-tools-list.mjs) e é comparado aqui.
//
// Uso: node --test tests/tools-list.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startMcp, TOKEN } from "./helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = join(__dirname, "snapshot", "tools-list.json");

let mcp;

before(async () => {
  mcp = await startMcp();
});

after(async () => {
  mcp?.close();
});

test("tools/list bate com o snapshot (JSON exato)", async () => {
  const esperado = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  const res = await fetch(`${mcp.base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json.result.tools, esperado);
});
