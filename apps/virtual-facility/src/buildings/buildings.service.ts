import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Outbox } from '@app/outbox';
import { WORKFLOWS_SERVICE } from './constants';
import { CreateBuildingDto } from './dto/create-building.dto';
import { UpdateBuildingDto } from './dto/update-building.dto';
import { Building } from './entities/building.entity';

@Injectable()
export class BuildingsService {
  constructor(
    @InjectRepository(Building)
    private readonly buildingsRepository: Repository<Building>,
    private readonly dataSource: DataSource,
  ) {}

  async create(createBuildingDto: CreateBuildingDto): Promise<Building> {
    return this.dataSource.transaction(async (manager) => {
      const buildingsRepository = manager.getRepository(Building);
      const outboxRepository = manager.getRepository(Outbox);

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

      return savedBuilding;
    });
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
}
