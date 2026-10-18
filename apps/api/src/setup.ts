import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { Logger } from 'nestjs-pino';
import { API_PREFIX } from '@voltex/shared';
import type { Env } from './config/env';

/** Configuração HTTP compartilhada entre `main.ts` e os testes e2e (para testar o app como ele roda de verdade). */
/**
 * Define o ID da requisição UMA vez, antes de qualquer outro middleware, e o devolve no header.
 * Logs (pino), auditoria (CLS) e o corpo dos erros usam o mesmo `req.id`, então um ID encontrado
 * em qualquer lugar rastreia a requisição inteira. Aceita o `x-request-id` do cliente se for seguro.
 */
export function requestIdMiddleware(
  req: Request & { id?: string },
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.headers['x-request-id'];
  const id =
    typeof incoming === 'string' && /^[\w.:-]{1,100}$/.test(incoming) ? incoming : randomUUID();
  req.id = id;
  res.setHeader('x-request-id', id);
  next();
}

export function configureApp(app: INestApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.use(requestIdMiddleware);
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX.replace(/^\//, ''));

  // O Swagger UI usa scripts inline; a CSP padrão do helmet o bloqueia, então só ele fica sem CSP.
  const strict = helmet();
  const relaxed = helmet({ contentSecurityPolicy: false });
  app.use((req: Request, res: Response, next: NextFunction) =>
    req.path.startsWith('/api/docs') ? relaxed(req, res, next) : strict(req, res, next),
  );

  app.use(cookieParser());
  app.enableCors({
    origin: config
      .get('CORS_ORIGIN', { infer: true })
      .split(',')
      .map((origin) => origin.trim()),
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  app.enableShutdownHooks();
}

export function setupSwagger(app: INestApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Voltex SolTech API')
      .setDescription(
        'API da suíte Voltex SolTech (CRM Solar, Solar Calculator, Solar Engine Studio e Off-Grid Designer).',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('api/docs', app, cleanupOpenApiDoc(document), {
    jsonDocumentUrl: 'api/docs-json',
  });
}
