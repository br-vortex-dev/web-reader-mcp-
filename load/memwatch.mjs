// Preload de instrumentacao: forca um GC (precisa de --expose-gc) e imprime o
// heap VIVO do processo no stderr. Usado pelo harness de carga para medir a
// memoria do servidor por dentro, sem alterar o server.js.
const intervalMs = Number(process.env.MEMWATCH_MS || 250);

const timer = setInterval(() => {
  if (globalThis.gc) globalThis.gc();
  const m = process.memoryUsage();
  process.stderr.write(`MEMWATCH heapUsed=${m.heapUsed} rss=${m.rss}\n`);
}, intervalMs);
timer.unref();
