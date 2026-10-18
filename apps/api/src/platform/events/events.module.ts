import { Global, Module } from '@nestjs/common';
import { EventBus } from './event-bus.service';
import { OutboxPublisher } from './outbox-publisher.service';

@Global()
@Module({ providers: [EventBus, OutboxPublisher], exports: [EventBus, OutboxPublisher] })
export class EventsModule {}
