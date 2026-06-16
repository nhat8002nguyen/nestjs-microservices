import { CreateWorkflowDto, UpdateWorkflowDto } from '@app/workflows';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workflow } from '@app/workflows';

@Injectable()
export class WorkflowsService {
  constructor(
    @InjectRepository(Workflow)
    private readonly workflowsRepository: Repository<Workflow>,
  ) {}

  async create(createWorkflowDto: CreateWorkflowDto): Promise<Workflow> {
    const workflow = this.workflowsRepository.create(createWorkflowDto);
    console.log('Creating workflow for building', workflow.buildingId);
    return this.workflowsRepository.save(workflow);
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
