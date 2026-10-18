#!/usr/bin/env node
/**
 * _check-video-live.mjs — prova LOCAL do read_video contra a web real.
 *
 * Sobe o servidor de verdade (modo HTTP, produção — bloqueio de hosts
 * privados LIGADO) e chama a ferramenta como uma IA chamaria, contra:
 *   1. YouTube  — metadados completos; transcrição pode estar bloqueada
 *                 (robots/vazio) e a saída TEM de declarar o motivo;
 *   2. Vimeo    — metadados + transcrição (a plataforma publica VTT);
 *   3. legenda direta (.vtt público da MDN) — baixa e converte.
 *
 * Uso: node dev/_check-video-live.mjs
 */
import { startMcp } from "../tests/helpers.mjs";

let pass = 0;
let fail = 0;
const check = (cond, rotulo, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${rotulo}${extra ? "  ->  " + extra : ""}`);
  if (cond) pass++;
  else fail++;
};

const mcp = await startMcp();

try {
  // ---------- 1. YouTube ----------
  {
    const r = await mcp.call("read_video", {
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      maxChars: 6000,
      timeoutMs: 20000,
    });
    const t = r.text;
    check(!r.isError, "YouTube: chamada sem erro de transporte", r.isError ? t.slice(0, 120) : "");
    check(/^# .+/.test(t) && !/\(sem título\)/.test(t), "YouTube: título presente");
    check(/Plataforma: YouTube/.test(t), "YouTube: plataforma identificada");
    check(/Canal: Rick Astley/.test(t), "YouTube: canal correto");
    check(/Duracao: 3:33/.test(t), "YouTube: duração 3:33");
    check(/Visualizacoes: \d/.test(t), "YouTube: visualizações presentes");
    check(/Legendas na plataforma: .*pt-BR/.test(t), "YouTube: faixas de legenda listadas");
    const transcricao = (t.match(/Transcricao: [^\n]*/) || [""])[0];
    check(/Transcricao: /.test(t), "YouTube: campo de transcrição presente", transcricao.slice(0, 100));
    // Estado atual provado: bloqueada pelo robots do YouTube. Aceita sucesso;
    // se indisponível, o motivo tem de estar explícito.
    if (/Transcricao: indisponivel/.test(t)) {
      check(/robots|vazio/i.test(transcricao), "YouTube: motivo da indisponibilidade explícito", transcricao.slice(0, 120));
    }
    console.log(`   (transcrição: ${transcricao.slice(0, 110)})`);
  }

  // ---------- 2. Vimeo ----------
  {
    const r = await mcp.call("read_video", {
      url: "https://vimeo.com/76979871",
      maxChars: 8000,
      timeoutMs: 20000,
    });
    const t = r.text;
    check(!r.isError, "Vimeo: chamada sem erro de transporte", r.isError ? t.slice(0, 120) : "");
    check(/Plataforma: Vimeo/.test(t), "Vimeo: plataforma identificada");
    check(/The New Vimeo Player/.test(t), "Vimeo: título correto");
    check(/Duracao: 1:02/.test(t), "Vimeo: duração 1:02");
    check(/Transcricao: \d+ blocos/.test(t), "Vimeo: transcrição presente");
    check(/\[0:05\]/.test(t), "Vimeo: timestamp da primeira fala (0:05)");
    check(/[Hh]ere at Vimeo/.test(t), "Vimeo: texto da legenda presente");
    const amostra = (t.match(/\[0:05\][^\n]*/) || [""])[0];
    console.log(`   (primeira fala: ${amostra.slice(0, 100)})`);
  }

  // ---------- 3. Legenda direta (.vtt público) ----------
  {
    const r = await mcp.call("read_video", {
      url: "https://interactive-examples.mdn.mozilla.net/media/examples/friday.vtt",
      maxChars: 3000,
      timeoutMs: 20000,
    });
    const t = r.text;
    check(!r.isError, "VTT direto: chamada sem erro de transporte", r.isError ? t.slice(0, 120) : "");
    check(/Plataforma: Arquivo de legenda/.test(t), "VTT direto: plataforma identificada");
    check(/Transcricao: \d+ blocos/.test(t), "VTT direto: transcrição presente");
    check(/Hildy/.test(t), "VTT direto: fala 'Hildy' presente");
  }
} finally {
  mcp.close();
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
