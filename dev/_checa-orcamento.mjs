#!/usr/bin/env node
// Checagem pontual: 64 leituras simultâneas da MESMA página de 1,4 MB — todas
// no estágio de download ao mesmo tempo. Se o pico de orçamento continuar em
// 1 MB, há defeito no contador; se subir perto de 16 MB, o número baixo da
// rajada de 500 era sobreposição pequena mesmo.
process.env.ALLOW_PRIVATE_HOSTS = "1";
const { spawn } = await import("node:child_process");
const { callTool } = await import("../src/tools.mjs");
const { orcamentoSaida } = await import("../src/fetch.mjs");

const filho = spawn(process.execPath, ["dev/_extremo-servidor.mjs"], { stdio: ["ignore", "pipe", "pipe"] });
const url = await new Promise((resolve, reject) => {
  let out = "";
  const prazo = setTimeout(() => reject(new Error("servidor nao subiu")), 8000);
  filho.stdout.on("data", (d) => {
    out += d;
    const m = out.match(/URL (http:\/\/127\.0\.0\.1:\d+)/);
    if (m) {
      clearTimeout(prazo);
      resolve(m[1]);
    }
  });
});

const N = 64;
const t0 = performance.now();
const rs = await Promise.all(
  Array.from({ length: N }, (_, i) =>
    callTool("read_page", { url: `${url}/pagina?i=O${i}`, maxChars: 25000, timeoutMs: 60000 }).then(
      (t) => t.length,
      (e) => `${e.name}: ${e.message}`
    )
  )
);
console.log(`${N} leituras em ${(performance.now() - t0).toFixed(0)} ms`);
console.log("primeiras saidas:", rs.slice(0, 3));
console.log("orcamento:", JSON.stringify(orcamentoSaida.stats));

// Controle: fetch cru (sem limitadores do projeto) nas mesmas 64 URLs. Se o
// tempo tambem for ~1 s, a serializacao e do undici/servidor local, nao do MCP.
{
  const t1 = performance.now();
  const corpos = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      fetch(`${url}/pagina?i=R${i}`).then((r) => r.arrayBuffer().then((b) => b.byteLength))
    )
  );
  console.log(
    `fetch cru: ${N} corpos de ${(corpos[0] / 1048576).toFixed(2)} MB em ${(performance.now() - t1).toFixed(0)} ms`
  );
}
filho.kill("SIGTERM");
setTimeout(() => {
  filho.kill("SIGKILL");
  process.exit(0);
}, 1000);
