import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateBuildingDto } from './dto/create-building.dto';
import { UpdateBuildingDto } from './dto/update-building.dto';
import { Building } from './entities/building.entity';

@Injectable()
export class BuildingsService {
  constructor(
    @InjectRepository(Building)
    private readonly buildingsRepository: Repository<Building>,
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

  async createWorkflow(buildingId: number): Promise<any> {
    const response = await fetch(
      `http://${process.env.WORKFLOWS_SERVICE_HOST ?? 'workflows-service'}:${process.env.WORKFLOWS_SERVICE_PORT ?? 3001}/workflows`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Building Workflow',
          buildingId,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Workflow service responded with ${response.status}`);
    }

    return response.json();
  }
}
