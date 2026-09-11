import {
  Controller,
  Get,
  Body,
  Patch,
  Param,
  Delete,
  Logger,
} from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { Channel, Message } from 'amqplib';
import { InboxService } from '../../../../libs/inbox/src/inbox.service';
import { WorkflowsService } from './workflows.service';
import { CreateWorkflowDto, UpdateWorkflowDto } from '@app/workflows';

@Controller('workflows')
export class WorkflowsController {
  private readonly logger = new Logger(WorkflowsController.name);

  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly inboxService: InboxService,
  ) {}

  @EventPattern('workflows.create')
  async create(
    @Payload() createWorkflowDto: CreateWorkflowDto,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef() as Channel;
    const originalMessage = context.getMessage() as Message;
    const messageId = originalMessage.properties.messageId as
      | string
      | undefined;

    if (!messageId) {
      this.logger.error(
        'Missing messageId on workflows.create; acking without store',
      );
      channel.ack(originalMessage);
      return;
    }

    const stored = await this.inboxService.store({
      messageId,
      type: 'workflows.create',
      payload: createWorkflowDto as unknown as Record<string, unknown>,
    });
    this.logger.log(
      `[rmq → inbox] stored messageId=${messageId} inboxId=${stored.id} status=${stored.status}; acking RMQ`,
    );
    channel.ack(originalMessage);
  }

  @Get()
  findAll() {
    return this.workflowsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.workflowsService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateWorkflowDto: UpdateWorkflowDto,
  ) {
    return this.workflowsService.update(+id, updateWorkflowDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.workflowsService.remove(+id);
  }
}
