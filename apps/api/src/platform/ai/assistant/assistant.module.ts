import { Module } from '@nestjs/common';
import { AiToolsModule } from '../tools/ai-tools.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { AiConversationsService } from './conversations.service';

/** O assistente (Fase 12E): orquestra pergunta, ferramentas, validação e conversas. */
@Module({
  imports: [AiToolsModule],
  controllers: [AssistantController],
  providers: [AssistantService, AiConversationsService],
  exports: [AssistantService],
})
export class AssistantModule {}
