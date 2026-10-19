# Site de apresentação (build Vite + nginx). Contexto de build: a RAIZ do repositório.
#   docker build -f apps/site/Dockerfile -t voltex/site --build-arg VITE_APP_URL=https://app.suaempresa.com.br .
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
# Endereços gravados no site na hora da compilação: a aplicação (botão "Entrar") e a chave do formulário de contato.
ARG VITE_APP_URL
ARG VITE_LEAD_KEY
ENV VITE_APP_URL=$VITE_APP_URL VITE_LEAD_KEY=$VITE_LEAD_KEY
RUN pnpm turbo run build --filter=@voltex/site

FROM nginxinc/nginx-unprivileged:alpine AS runtime
COPY apps/site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/site/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
