# API NestJS (modular monolith). Contexto de build: a RAIZ do repositório.
#   docker build -f apps/api/Dockerfile -t voltex/api .
#
# Imagem enxuta, em três estágios:
#  1. build    compila tudo e monta só o que a API precisa para rodar (dependências de PRODUÇÃO, sem peers opcionais
#              como a CLI do Prisma, e sem arquivos que o Node nunca lê: mapas, tipos, documentação);
#  2. node     só fornece o binário do Node (sem npm, yarn nem corepack);
#  3. runtime  Alpine mínimo + o binário do Node + a aplicação, rodando sem root.
# As migrações do banco NÃO rodam aqui: têm imagem própria (docker/migrate.Dockerfile).

FROM node:24-alpine AS node

FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@voltex/api
# `auto-install-peers=false`: o `@prisma/client` declara a CLI do Prisma como peer opcional, e instalá-la traria cerca de
# 150 MB (estúdio, PGlite, TypeScript...) que a API nunca usa em produção.
RUN pnpm --config.auto-install-peers=false --filter @voltex/api deploy --prod --ignore-scripts /out
# Remove o que o Node não lê em tempo de execução. Licenças são mantidas.
RUN find /out/node_modules \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' \
      -o -iname 'README*' -o -iname 'CHANGELOG*' -o -iname 'HISTORY*' \) -type f -delete
# O TypeScript só entra como "peer" opcional do cliente do Prisma (para tipos) e o Prisma só fala com PostgreSQL aqui:
# os compiladores de consulta dos outros bancos (MySQL, SQLite, SQL Server, CockroachDB) nunca são carregados.
RUN rm -rf /out/node_modules/.pnpm/typescript@* \
    && find /out/node_modules/.pnpm -path '*@prisma/client/runtime/*' -type f \
         \( -name '*.cockroachdb.*' -o -name '*.mysql.*' -o -name '*.sqlite.*' -o -name '*.sqlserver.*' \) -delete

FROM alpine:3.24 AS runtime
# libstdc++ e libgcc: o binário do Node precisa delas no Alpine.
RUN apk add --no-cache libstdc++ libgcc \
    && addgroup -g 1000 node && adduser -u 1000 -G node -s /bin/sh -D node
COPY --from=node /usr/local/bin/node /usr/local/bin/node
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD sh -c 'wget -qO- "http://127.0.0.1:${API_PORT:-${PORT:-3000}}/api/v1/health" || exit 1'
CMD ["node", "dist/main.js"]
