import { Inject, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WORKFLOWS_SERVICE } from 'apps/virtual-facility/src/buildings/constants';
import { lastValueFrom } from 'rxjs';
import { Outbox } from './entities/outbox.entity';
import { OutboxService } from './outbox.service';

export class OutboxProcessor {
  private readonly logger = new Logger(OutboxProcessor.name);
  constructor(
    private readonly outboxService: OutboxService,
    @Inject(WORKFLOWS_SERVICE)
    private readonly workflowsService: ClientProxy,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async processOutbox() {
    this.logger.log('Processing outbox messages');

    const messages = await this.outboxService.getPendingOutboxMessages({
      target: WORKFLOWS_SERVICE.description as string,
      take: 100,
    });
    this.logger.log(`Found ${messages.length} messages to process`);

    for (const message of messages) {
      await this.dispatchWorkflowEvent(message);
      this.logger.log(`Marking message ${message.id} as processed`);
      await this.outboxService.markAsProcessed(message.id);
    }
  }

  async dispatchWorkflowEvent(message: Outbox) {
    this.logger.log(`Dispatching workflow event for message ${message.id}`);
    await lastValueFrom(
      this.workflowsService.emit(message.type, message.payload),
    );
  }
}
