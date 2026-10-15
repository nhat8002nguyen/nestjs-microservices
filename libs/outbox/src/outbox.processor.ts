import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WORKFLOWS_SERVICE } from 'apps/virtual-facility/src/buildings/constants';
import { lastValueFrom } from 'rxjs';
import { DataSource } from 'typeorm';
import { Outbox } from './entities/outbox.entity';
import { OutboxService } from './outbox.service';

@Injectable()
export class OutboxProcessor {
  private readonly logger = new Logger(OutboxProcessor.name);

  constructor(
    private readonly outboxService: OutboxService,
    private readonly dataSource: DataSource,
    @Inject(WORKFLOWS_SERVICE)
    private readonly workflowsService: ClientProxy,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async processOutbox(): Promise<void> {
    const target = WORKFLOWS_SERVICE.description as string;

    for (let i = 0; i < 100; i++) {
      const hasRow = await this.dataSource.transaction(async (manager) => {
        const [message] = await this.outboxService.claimPending({
          target,
          take: 1,
          manager,
        });
        if (!message) {
          return false;
        }
        await this.dispatchWorkflowEvent(message);
        await this.outboxService.markAsProcessed(message.id, manager);
        return true;
      });

      if (!hasRow) {
        break;
      }
    }
  }

  async dispatchWorkflowEvent(message: Outbox): Promise<void> {
    const messageId = `outbox:${message.id}`;
    this.logger.log(
      `[outbox -> rmq] emit ${message.type} messageId=${messageId}`,
    );
    const record = new RmqRecordBuilder(message.payload)
      .setOptions({ messageId })
      .build();
    await lastValueFrom(this.workflowsService.emit(message.type, record));
  }
}
