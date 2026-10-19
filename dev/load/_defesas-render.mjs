// Testa as defesas do servidor publicado: auth, entrada invalida, SSRF.
const U = "https://web-reader-mcp-13z0.onrender.com/mcp";
const T = "tRqOmW3l9kVq8rgOdIvi7hBIW3WV9YJs/LiBx446FYw=";

const post = (h, b) =>
  fetch(U, { method: "POST", headers: h, body: b, signal: AbortSignal.timeout(40000) })
    .then(async (r) => `HTTP ${r.status} | ${(await r.text()).replace(/\s+/g, " ").slice(0, 150)}`)
    .catch((e) => "erro de rede: " + e.message);

const ct = { "content-type": "application/json" };
const aut = { ...ct, authorization: "Bearer " + T };
const rpc = (id, method, params) => JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });

const chamada = (id, name, args) => rpc(id, "tools/call", { name, arguments: args });

const casos = [
  ["sem token", ct, rpc(1, "tools/list")],
  ["token errado", { ...ct, authorization: "Bearer errado" }, rpc(1, "tools/list")],
  ["ferramenta inexistente", aut, chamada(2, "nao_existe", {})],
  ["json quebrado", aut, '{"jsonrpc":'],
  ["file:// local", aut, chamada(3, "read_page", { url: "file:///C:/Windows/win.ini" })],
  ["SSRF metadata cloud", aut, chamada(4, "read_page", { url: "http://169.254.169.254/latest/meta-data/" })],
  ["SSRF localhost", aut, chamada(5, "read_page", { url: "http://127.0.0.1:6379/" })],
  ["url vazia", aut, chamada(6, "read_page", { url: "" })],
  ["url gigante", aut, chamada(7, "read_page", { url: "https://example.com/" + "a".repeat(9000) })],
  ["maxChars negativo", aut, chamada(8, "read_page", { url: "https://example.com", maxChars: -5 })],
  ["maxChars absurdo", aut, chamada(9, "read_page", { url: "https://example.com", maxChars: 99999999 })],
  ["timeout 0", aut, chamada(10, "read_page", { url: "https://example.com", timeoutMs: 0 })],
];

for (const [nome, h, corpo] of casos) {
  console.log(`--- ${nome}`);
  console.log("    " + (await post(h, corpo)));
}

// tools/list valido: confere quais ferramentas estao publicadas
console.log("--- tools/list (com token)");
const r = await fetch(U, { method: "POST", headers: aut, body: rpc(99, "tools/list"), signal: AbortSignal.timeout(30000) });
const j = await r.json();
const nomes = (j.result?.tools || []).map((t) => t.name);
console.log(`    HTTP ${r.status} | ${nomes.length} ferramentas: ${nomes.join(", ")}`);
