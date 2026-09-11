import { Test, TestingModule } from '@nestjs/testing';
import { RmqContext } from '@nestjs/microservices';
import { InboxService } from '../../../../libs/inbox/src/inbox.service';
import { CreateWorkflowDto } from '@app/workflows';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';

describe('WorkflowsController', () => {
  let controller: WorkflowsController;
  let inboxService: { store: jest.Mock };
  let workflowsService: { create: jest.Mock };

  const dto: CreateWorkflowDto = { name: 'wf', buildingId: 1 };

  beforeEach(async () => {
    inboxService = { store: jest.fn().mockResolvedValue({ id: 1 }) };
    workflowsService = { create: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkflowsController],
      providers: [
        { provide: WorkflowsService, useValue: workflowsService },
        { provide: InboxService, useValue: inboxService },
      ],
    }).compile();

    controller = module.get(WorkflowsController);
  });

  function contextWith(message: {
    properties: { messageId?: string };
  }): { context: RmqContext; channel: { ack: jest.Mock } } {
    const channel = { ack: jest.fn() };
    const context = {
      getChannelRef: () => channel,
      getMessage: () => message,
    } as unknown as RmqContext;
    return { context, channel };
  }

  it('stores the message and acks without calling create', async () => {
    const { context, channel } = contextWith({
      properties: { messageId: 'outbox:9' },
    });

    await controller.create(dto, context);

    expect(inboxService.store).toHaveBeenCalledWith({
      messageId: 'outbox:9',
      type: 'workflows.create',
      payload: dto,
    });
    expect(channel.ack).toHaveBeenCalledWith({
      properties: { messageId: 'outbox:9' },
    });
    expect(workflowsService.create).not.toHaveBeenCalled();
  });

  it('acks duplicate stores and does not call create', async () => {
    inboxService.store.mockResolvedValue({ id: 1, messageId: 'outbox:9' });
    const { context, channel } = contextWith({
      properties: { messageId: 'outbox:9' },
    });

    await controller.create(dto, context);

    expect(channel.ack).toHaveBeenCalled();
    expect(workflowsService.create).not.toHaveBeenCalled();
  });

  it('acks missing messageId without storing', async () => {
    const { context, channel } = contextWith({ properties: {} });

    await controller.create(dto, context);

    expect(inboxService.store).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalled();
    expect(workflowsService.create).not.toHaveBeenCalled();
  });

  it('does not ack when store fails', async () => {
    inboxService.store.mockRejectedValue(new Error('db down'));
    const { context, channel } = contextWith({
      properties: { messageId: 'outbox:9' },
    });

    await expect(controller.create(dto, context)).rejects.toThrow('db down');
    expect(channel.ack).not.toHaveBeenCalled();
  });
});
