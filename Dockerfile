# web-reader-mcp — imagem de produção.
#
# O projeto é zero dependências: não há `npm install` em lugar nenhum, então a
# imagem não instala nada além do próprio Node. É por isso que ela é pequena e
# o build não tem rede: `COPY . .` basta.
#
# Node 22 é o alvo: é a versão em que a suíte roda (o `node:test` do 22 já tem
# tudo o que os testes usam) e a que o render.yaml espera.

FROM node:22-alpine

# Não rodar como root: se algo escapar do servidor, escapa sem privilégio.
# O usuário `node` já existe na imagem oficial.
WORKDIR /app

# Só o necessário para rodar. `dev/` (baterias e medições), `tests/` e o
# histórico do git ficam fora — não servem no container e só engordam a imagem.
COPY package.json ./
COPY server.js ./
COPY src ./src

# Cache e memória vivem em processo; nada é gravado em disco.
USER node

# O Render injeta PORT; localmente o padrão é 3000 (config.mjs).
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Healthcheck sem dependência: usa o próprio Node para bater no /health.
# O `-e` garante que uma resposta 404/500 também derrube o container, em vez
# de deixá-lo "de pé" respondendo errado.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
