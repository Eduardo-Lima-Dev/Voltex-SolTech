import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import type { ZodError } from 'zod';
import type { ApiError } from '@voltex/shared';
import { Prisma } from '@voltex/database';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'VALIDATION_ERROR',
  429: 'TOO_MANY_REQUESTS',
};

/** Converte qualquer erro no formato único `ApiError`, sem vazar detalhes internos. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request & { id?: string }>();
    const requestId = request.id !== undefined ? String(request.id) : undefined;

    const body = this.toApiError(exception);
    if (requestId) body.requestId = requestId;

    if (body.statusCode >= 500) {
      this.logger.error({ err: exception, requestId }, 'Erro não tratado');
    }
    response.status(body.statusCode).json(body);
  }

  private toApiError(exception: unknown): ApiError {
    if (exception instanceof ZodValidationException) {
      const error = exception.getZodError() as ZodError;
      return {
        statusCode: 422,
        code: 'VALIDATION_ERROR',
        message: 'Dados inválidos',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const message =
        typeof payload === 'string'
          ? payload
          : Array.isArray((payload as { message?: unknown }).message)
            ? (payload as { message: string[] }).message.join('; ')
            : ((payload as { message?: string }).message ?? exception.message);
      const customCode =
        typeof payload === 'object' ? (payload as { code?: string }).code : undefined;
      const data =
        typeof payload === 'object'
          ? (payload as { data?: Record<string, unknown> }).data
          : undefined;
      return {
        statusCode: status,
        code: customCode ?? CODE_BY_STATUS[status] ?? 'HTTP_ERROR',
        message,
        ...(data ? { data } : {}),
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return {
          statusCode: 409,
          code: 'CONFLICT',
          message: 'Já existe um registro com esses dados',
        };
      }
      if (exception.code === 'P2025') {
        return { statusCode: 404, code: 'NOT_FOUND', message: 'Registro não encontrado' };
      }
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Erro interno do servidor',
    };
  }
}
