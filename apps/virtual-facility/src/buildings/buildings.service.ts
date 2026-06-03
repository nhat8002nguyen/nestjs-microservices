import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Workflow } from 'apps/workflows-service/src/workflows/entities/workflow.entity';
import { lastValueFrom } from 'rxjs';
import { Repository } from 'typeorm';
import { WORKFLOWS_SERVICE } from './constants';
import { CreateBuildingDto } from './dto/create-building.dto';
import { UpdateBuildingDto } from './dto/update-building.dto';
import { Building } from './entities/building.entity';

@Injectable()
export class BuildingsService {
  constructor(
    @InjectRepository(Building)
    private readonly buildingsRepository: Repository<Building>,
    @Inject(WORKFLOWS_SERVICE)
    private readonly workflowsService: ClientProxy,
  ) {}

  async create(createBuildingDto: CreateBuildingDto) {
    const building = this.buildingsRepository.create({
      name: createBuildingDto.name,
    });
    const savedBuilding = await this.buildingsRepository.save(building);
    await this.createWorkflow(savedBuilding.id);
    return savedBuilding;
  }

  findAll(): Promise<Building[]> {
    return this.buildingsRepository.find();
  }

  async findOne(id: number): Promise<Building> {
    const building = await this.buildingsRepository.findOne({ where: { id } });

    if (!building) {
      throw new NotFoundException(`Building #${id} not found`);
    }

    return building;
  }

  async update(
    id: number,
    updateBuildingDto: UpdateBuildingDto,
  ): Promise<Building> {
    const building = await this.findOne(id);
    Object.assign(building, updateBuildingDto);
    return this.buildingsRepository.save(building);
  }

  async remove(id: number): Promise<void> {
    const building = await this.findOne(id);
    await this.buildingsRepository.remove(building);
  }

  async createWorkflow(buildingId: number): Promise<Workflow> {
    const newWorkflow: Workflow = await lastValueFrom(
      this.workflowsService.send('workflows.create', {
        name: 'Building Workflow with nats',
        buildingId,
      }),
    );
    console.log(newWorkflow);
    return newWorkflow;
  }
}
