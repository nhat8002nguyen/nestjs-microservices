import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateWorkflowDto, UpdateWorkflowDto } from '@app/workflows';
import { Repository } from 'typeorm';
import { Workflow } from './entities/workflow.entity';

@Injectable()
export class WorkflowsService {
  constructor(
    @InjectRepository(Workflow)
    private readonly workflowsRepository: Repository<Workflow>,
  ) {}

  async create(createWorkflowDto: CreateWorkflowDto) {
    const workflow = this.workflowsRepository.create(createWorkflowDto);
    return this.workflowsRepository.save(workflow);
  }

  findAll() {
    return this.workflowsRepository.find();
  }

  async findOne(id: number) {
    const workflow = await this.workflowsRepository.findOneBy({ id });
    if (!workflow) {
      throw new NotFoundException(`Workflow with id ${id} not found`);
    }
    return workflow;
  }

  async update(id: number, updateWorkflowDto: UpdateWorkflowDto) {
    const workflow = await this.findOne(id);
    if (updateWorkflowDto.buildingId !== undefined) {
      workflow.buildingId = updateWorkflowDto.buildingId;
    }
    if (updateWorkflowDto.name !== undefined) {
      workflow.name = updateWorkflowDto.name;
    }
    return this.workflowsRepository.save(workflow);
  }

  async remove(id: number) {
    const workflow = await this.findOne(id);
    await this.workflowsRepository.remove(workflow);
    return workflow;
  }
}
