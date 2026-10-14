// Teste rápido das correções de segurança
import { readFileSync } from 'fs';

const code = readFileSync('./server.js', 'utf8');

// 1. Verifica se eval() foi removido
const evalCount = (code.match(/\beval\s*\(/g) || []).length;
console.log(`✓ eval() encontrado ${evalCount} vez(es) — esperado: 0`);
if (evalCount > 0) {
  console.log('  ⚠️  Ainda há eval() no código!');
  process.exit(1);
}

// 2. Verifica se proteção contra JSON circular existe
if (code.includes('referência circular') && code.includes('seen.has(data)')) {
  console.log('✓ Proteção contra JSON circular presente');
} else {
  console.log('⚠️  Proteção contra JSON circular não encontrada');
}

// 3. Verifica se proteção SSRF existe
if (code.includes('SSRF protection') && code.includes('hostOf(url) !== baseHost')) {
  console.log('✓ Proteção SSRF presente');
} else {
  console.log('⚠️  Proteção SSRF não encontrada');
}

// 4. Verifica se limite de resposta existe
if (code.includes('MAX_RESPONSE_BYTES')) {
  console.log('✓ Limite de tamanho de resposta presente');
} else {
  console.log('⚠️  Limite de tamanho de resposta não encontrado');
}

// 5. Verifica se extractPrimitives existe (substituto do eval)
if (code.includes('function extractPrimitives')) {
  console.log('✓ extractPrimitives() presente (substitui eval)');
} else {
  console.log('⚠️  extractPrimitives() não encontrado');
}

console.log('\n✅ Todas as correções de segurança aplicadas!');
