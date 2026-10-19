// Preload de diagnóstico: mede a maior pausa do event loop e grita quando
// passar de um limiar. Não muda nada no servidor — só observa.
const LIMIAR = Number(process.env.LAG_MS || 1000);
let ultima = Date.now();

setInterval(() => {
  const agora = Date.now();
  const pausa = agora - ultima;
  ultima = agora;
  if (pausa >= LIMIAR) {
    console.error(`LAGTOTAL pausa=${pausa}ms em ${new Date().toISOString()}`);
  }
}, 100).unref();

// Também observa a memória para ver se a bomba é de heap.
let memPico = 0;
setInterval(() => {
  const mb = process.memoryUsage().rss / 1024 / 1024;
  if (mb > memPico) {
    memPico = mb;
    if (mb > 400) console.error(`MEMALTA rss=${mb.toFixed(0)}MB`);
  }
}, 500).unref();

console.error("diagnostico de lag ativo");
