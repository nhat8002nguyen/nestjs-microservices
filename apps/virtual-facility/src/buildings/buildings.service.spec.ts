import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BuildingsService } from './buildings.service';
import { WORKFLOWS_SERVICE } from './constants';
import { Building } from './entities/building.entity';

describe('BuildingsService', () => {
  let service: BuildingsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BuildingsService,
        {
          provide: getRepositoryToken(Building),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
          },
        },
        {
          provide: WORKFLOWS_SERVICE,
          useValue: { emit: jest.fn(), send: jest.fn() },
        },
        {
          provide: DataSource,
          useValue: { createQueryRunner: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(BuildingsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
