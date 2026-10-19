# Job único que aplica as migrations do Prisma (`prisma migrate deploy`) antes de a API subir.
# Estágios: `deps` instala a CLI do Prisma (e o motor de migração) e poda o que ela não usa para migrar; `runtime` é um
# Alpine mínimo com o binário do Node, sem npm. Contexto de build: a RAIZ do repositório.
FROM node:24-alpine AS node

FROM node:24-alpine AS deps
RUN apk add --no-cache openssl
WORKDIR /app
RUN npm install --no-save --no-audit --no-fund prisma@7.10.1 dotenv \
    && rm -rf /root/.npm /tmp/* \
    && find node_modules \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' \
         -o -iname 'README*' -o -iname 'CHANGELOG*' \) -type f -delete

FROM alpine:3.24 AS runtime
RUN apk add --no-cache libstdc++ libgcc openssl \
    && addgroup -g 1000 node && adduser -u 1000 -G node -s /bin/sh -D node
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node packages/database/prisma.config.ts ./prisma.config.ts
COPY --chown=node:node packages/database/prisma ./prisma
USER node
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]
