#!/usr/bin/env node
/**
 * _prof-foco.mjs — perfil de UM caso isolado (por padrão, read_page em 1,4 MB).
 *
 * Uso: node --cpu-prof --cpu-prof-dir=dev/_prof-foco dev/_prof-foco.mjs
 *      CASO=rico node dev/_prof-foco.mjs
 */
process.env.ALLOW_PRIVATE_HOSTS = "1";

const { startFixture } = await import("../tests/helpers.mjs");
const { callTool } = await import("../src/tools.mjs");

const fixture = await startFixture();
const U = fixture.url;
let id = 0;

const casos = {
  pesada: () => ["read_page", { url: `${U}/page/pesada?kb=1400&v=${++id}`, maxChars: 25000 }],
  rica: () => ["read_page", { url: `${U}/pagina?v=${++id}`, maxChars: 50000 }],
};const CASO = process.env.CASO || "pesada";
const montar = casos[CASO];
const LOTE = Number(process.env.LOTE || 300);

// Aquecimento curto para o JIT estabilizar antes de medir.
for (let i = 0; i < 20; i++) await callTool(...montar());

const antes = process.cpuUsage();
const t0 = performance.now();
for (let i = 0; i < LOTE; i++) await callTool(...montar());
const cpu = process.cpuUsage(antes);
const ms = performance.now() - t0;

console.log(
  `${CASO || "pesada"}: ${LOTE} chamadas | CPU ${((cpu.user + cpu.system) / 1000 / LOTE).toFixed(3)} ms/chamada | parede ${(ms / LOTE).toFixed(3)} ms/chamada`
);
await fixture.close?.();
