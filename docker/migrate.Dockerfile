# Job único que aplica as migrations do Prisma (`prisma migrate deploy`) antes de a API subir.
FROM node:24-alpine
RUN apk add --no-cache openssl
WORKDIR /app
RUN npm install --no-save --no-audit --no-fund prisma@7.10.1 dotenv
COPY packages/database/prisma.config.ts ./prisma.config.ts
COPY packages/database/prisma ./prisma
USER node
CMD ["npx", "prisma", "migrate", "deploy"]
