import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { lastValueFrom } from 'rxjs';
import { DataSource, Repository } from 'typeorm';
import { Outbox } from '../../../../libs/outbox/src/entities/outbox.entity';
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
    private readonly dataSource: DataSource,
  ) {}

  async create(createBuildingDto: CreateBuildingDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const buildingsRepository = queryRunner.manager.getRepository(Building);
      const outboxRepository = queryRunner.manager.getRepository(Outbox);
      const building = buildingsRepository.create({
        name: createBuildingDto.name,
      });
      const savedBuilding = await buildingsRepository.save(building);

      await outboxRepository.save({
        type: 'workflows.create',
        payload: {
          name: 'Building Workflow with rabbitmq',
          buildingId: savedBuilding.id,
        },
        target: WORKFLOWS_SERVICE.description,
      });
      await queryRunner.commitTransaction();
      return savedBuilding;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
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

  async createWorkflow(buildingId: number) {
    const newWorkflow = await lastValueFrom<{
      id: number;
      buildingId: number;
      name: string;
    }>(
      this.workflowsService.emit('workflows.create', {
        name: 'Building Workflow with rabbitmq',
        buildingId,
      }),
    );
    console.log(newWorkflow);
    return newWorkflow;
  }
}
