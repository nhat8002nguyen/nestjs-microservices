import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BuildingsService } from './buildings.service';
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
      ],
    }).compile();

    service = module.get<BuildingsService>(BuildingsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
