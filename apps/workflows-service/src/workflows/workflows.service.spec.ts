import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Workflow } from '@app/workflows';
import { WorkflowsService } from './workflows.service';

describe('WorkflowsService', () => {
  let service: WorkflowsService;
  let repository: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOneBy: jest.Mock;
    remove: jest.Mock;
  };

  beforeEach(async () => {
    repository = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOneBy: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowsService,
        { provide: getRepositoryToken(Workflow), useValue: repository },
      ],
    }).compile();

    service = module.get(WorkflowsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('create without a manager uses the injected repository', async () => {
    const dto = { name: 'wf', buildingId: 1 };
    const created = { ...dto };
    const saved = { id: 3, ...dto };
    repository.create.mockReturnValue(created);
    repository.save.mockResolvedValue(saved);

    const result = await service.create(dto);

    expect(repository.create).toHaveBeenCalledWith(dto);
    expect(repository.save).toHaveBeenCalledWith(created);
    expect(result).toEqual(saved);
  });
});
