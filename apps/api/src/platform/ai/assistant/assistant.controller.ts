import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { Headers } from '@nestjs/common';
import { aiChatRequestSchema, aiFeedbackSchema, type AiChatEvent } from '@voltex/shared';
import { CurrentUser, RequirePermissions } from '../../../common/decorators';
import type { RequestUser } from '../../../common/context/request-user';
import { AssistantService } from './assistant.service';
import { AiConversationsService } from './conversations.service';

class ChatDto extends createZodDto(aiChatRequestSchema) {}
class FeedbackDto extends createZodDto(aiFeedbackSchema) {}

/** Mensagem pronta (e status) de um erro, para o evento de erro do fluxo. */
function describe(error: unknown): { code: string; message: string; status: number } {
  if (error instanceof HttpException) {
    const body = error.getResponse() as { code?: string; message?: string | string[] } | string;
    const message =
      typeof body === 'string'
        ? body
        : Array.isArray(body.message)
          ? body.message.join('; ')
          : body.message;
    return {
      code: typeof body === 'object' && body.code ? body.code : 'ERROR',
      message: message ?? 'Não foi possível responder agora.',
      status: error.getStatus(),
    };
  }
  return {
    code: 'ERROR',
    message: 'Não foi possível responder agora. Tente de novo.',
    status: 500,
  };
}

@ApiTags('Assistente de IA')
@ApiBearerAuth()
@Controller('ai')
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly conversations: AiConversationsService,
  ) {}

  /**
   * Pergunta ao assistente. Com `Accept: text/event-stream` responde em fluxo (progresso e resposta); sem isso,
   * devolve o JSON da resposta. Em qualquer falha, responde na hora com a mensagem pronta.
   */
  @Post('chat')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @RequirePermissions('ai.assistant.use')
  async chat(
    @Body() body: ChatDto,
    @CurrentUser() user: RequestUser,
    @Headers('accept') accept: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!accept?.includes('text/event-stream')) {
      res.json(await this.assistant.ask(user, body));
      return;
    }
    res.status(200).set({
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.flushHeaders();
    const send = (event: AiChatEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    // Batimento: proxies não derrubam a conexão enquanto a IA pensa.
    const beat = setInterval(() => res.write(': batimento\n\n'), 5_000);
    try {
      send({ type: 'answer', data: await this.assistant.ask(user, body, send) });
    } catch (error) {
      send({ type: 'error', ...describe(error) });
    } finally {
      clearInterval(beat);
      res.end();
    }
  }

  @Get('conversations')
  @RequirePermissions('ai.assistant.use')
  list() {
    return this.conversations.list();
  }

  @Get('conversations/:id')
  @RequirePermissions('ai.assistant.use')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.detail(id);
  }

  @Delete('conversations/:id')
  @HttpCode(200)
  @RequirePermissions('ai.assistant.use')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.remove(id);
  }

  @Post('messages/:id/feedback')
  @HttpCode(200)
  @RequirePermissions('ai.assistant.use')
  feedback(@Param('id', ParseUUIDPipe) id: string, @Body() body: FeedbackDto) {
    return this.conversations.feedback(id, body);
  }
}
