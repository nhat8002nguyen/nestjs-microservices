import { CreateWorkflowDto, UpdateWorkflowDto } from '@app/workflows';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Workflow } from '@app/workflows';

@Injectable()
export class WorkflowsService {
  private readonly logger = new Logger(WorkflowsService.name);

  constructor(
    @InjectRepository(Workflow)
    private readonly workflowsRepository: Repository<Workflow>,
  ) {}

  async create(
    createWorkflowDto: CreateWorkflowDto,
    manager?: EntityManager,
  ): Promise<Workflow> {
    const repository = manager
      ? manager.getRepository(Workflow)
      : this.workflowsRepository;
    const workflow = repository.create(createWorkflowDto);
    const saved = await repository.save(workflow);
    this.logger.log(
      `[inbox → workflow] created id=${saved.id} buildingId=${saved.buildingId} name=${saved.name} via=${manager ? 'inbox' : 'http'}`,
    );
    return saved;
  }

  findAll(): Promise<Workflow[]> {
    return this.workflowsRepository.find();
  }

  async findOne(id: number): Promise<Workflow> {
    const workflow = await this.workflowsRepository.findOneBy({ id });
    if (!workflow) {
      throw new NotFoundException(`Workflow with id ${id} not found`);
    }
    return workflow;
  }

  async update(
    id: number,
    updateWorkflowDto: UpdateWorkflowDto,
  ): Promise<Workflow> {
    const workflow = await this.findOne(id);
    if (updateWorkflowDto.buildingId !== undefined) {
      workflow.buildingId = updateWorkflowDto.buildingId;
    }
    if (updateWorkflowDto.name !== undefined) {
      workflow.name = updateWorkflowDto.name;
    }
    return this.workflowsRepository.save(workflow);
  }

  async remove(id: number): Promise<Workflow> {
    const workflow = await this.findOne(id);
    await this.workflowsRepository.remove(workflow);
    return workflow;
  }
}
