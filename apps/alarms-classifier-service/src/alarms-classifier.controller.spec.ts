import { Test, TestingModule } from '@nestjs/testing';
import { AlarmsClassifierController } from './alarms-classifier.controller';
import { AlarmsClassifierService } from './alarms-classifier.service';

describe('AlarmsClassifierController', () => {
  let alarmsClassifierController: AlarmsClassifierController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AlarmsClassifierController],
      providers: [AlarmsClassifierService],
    }).compile();

    alarmsClassifierController = app.get<AlarmsClassifierController>(AlarmsClassifierController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(alarmsClassifierController.getHello()).toBe('Hello World!');
    });
  });
});
