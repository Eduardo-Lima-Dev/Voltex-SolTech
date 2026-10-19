# API NestJS (modular monolith). Contexto de build: a RAIZ do repositório.
#   docker build -f apps/api/Dockerfile -t voltex/api .
FROM node:24-alpine AS build
RUN apk add --no-cache openssl && corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@voltex/api
# Só o necessário para rodar: dependências de produção + os pacotes do workspace já compilados.
RUN pnpm --filter @voltex/api deploy --prod --ignore-scripts /out

FROM node:24-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD sh -c 'wget -qO- "http://127.0.0.1:${API_PORT:-${PORT:-3000}}/api/v1/health" || exit 1'
CMD ["node", "dist/main.js"]
