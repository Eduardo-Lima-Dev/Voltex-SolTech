# Web React (build Vite + nginx). Contexto de build: a RAIZ do repositório.
#   docker build -f apps/web/Dockerfile -t voltex/web .
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
# A API responde no mesmo domínio, sob /api/v1 (o nginx faz o proxy).
ENV VITE_API_URL=/api/v1
# Endereço público do site, para o link "Voltar ao site" da tela de entrada (opcional).
ARG VITE_SITE_URL
ENV VITE_SITE_URL=$VITE_SITE_URL
RUN pnpm turbo run build --filter=@voltex/web

FROM nginxinc/nginx-unprivileged:alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
