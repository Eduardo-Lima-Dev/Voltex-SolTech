import './config/zod-locale';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { IncomingMessage } from 'node:http';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { CommonModule } from './common/common.module';
import { validateEnv, type Env } from './config/env';
import { AuditInterceptor } from './platform/audit/audit.interceptor';
import { AuditModule } from './platform/audit/audit.module';
import { AuthModule } from './platform/auth/auth.module';
import { JwtAuthGuard } from './platform/auth/jwt-auth.guard';
import { PermissionsGuard } from './platform/auth/permissions.guard';
import { DocumentsModule } from './platform/documents/documents.module';
import { EventsModule } from './platform/events/events.module';
import { HealthModule } from './platform/health/health.module';
import { MetricsModule } from './platform/metrics/metrics.module';
import { MailModule } from './platform/mail/mail.module';
import { PrismaModule } from './platform/prisma/prisma.module';
import { CatalogModule } from './platform/catalog/catalog.module';
import { EngineeringModule } from './products/engine/engineering.module';
import { OffgridModule } from './products/offgrid/offgrid.module';
import { DataHubModule } from './platform/data-hub/data-hub.module';
import { ReferenceDataModule } from './platform/reference-data/reference-data.module';
import { RulesModule } from './platform/rules/rules.module';
import { CalculatorModule } from './products/calculator/calculator.module';
import { CrmModule } from './products/crm/crm.module';
import { TenancyModule } from './platform/tenancy/tenancy.module';
import { UsersModule } from './platform/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Raiz do monorepo primeiro; variáveis já definidas no ambiente (Docker/CI) têm precedência.
      envFilePath: ['../../.env', '.env'],
      validate: validateEnv,
    }),
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        setup: (cls, req: IncomingMessage & { id?: string | number; ip?: string }) => {
          cls.set('requestId', String(req.id ?? randomUUID()));
          cls.set('ip', req.ip);
          cls.set('userAgent', req.headers['user-agent']);
        },
      },
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const env = config.get('NODE_ENV', { infer: true });
        return {
          pinoHttp: {
            level: env === 'test' ? 'silent' : env === 'production' ? 'info' : 'debug',
            // O ID já foi definido por `requestIdMiddleware` (setup.ts); aqui só o reaproveitamos.
            genReqId: (req: IncomingMessage & { id?: string }) => req.id ?? randomUUID(),
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
            ],
            autoLogging: {
              ignore: (req: IncomingMessage) => req.url?.endsWith('/health') ?? false,
            },
            customProps: (req: IncomingMessage & { user?: { id: string; tenantId: string } }) => ({
              tenantId: req.user?.tenantId,
              userId: req.user?.id,
            }),
            ...(env === 'development'
              ? {
                  transport: {
                    target: 'pino-pretty',
                    options: { singleLine: true, colorize: true },
                  },
                }
              : {}),
          },
        };
      },
    }),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [
          { name: 'default', ttl: 60_000, limit: config.get('THROTTLE_LIMIT', { infer: true }) },
        ],
        skipIf: () => config.get('THROTTLE_DISABLED', { infer: true }),
      }),
    }),
    CommonModule,
    PrismaModule,
    AuthModule,
    AuditModule,
    EventsModule,
    MailModule,
    TenancyModule,
    UsersModule,
    DocumentsModule,
    RulesModule,
    ReferenceDataModule,
    DataHubModule,
    CatalogModule,
    EngineeringModule,
    OffgridModule,
    CalculatorModule,
    CrmModule,
    HealthModule,
    MetricsModule,
  ],
  providers: [
    // A ordem importa: limite de requisições → autenticação → autorização.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
