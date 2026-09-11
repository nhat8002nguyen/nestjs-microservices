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

    alarmsClassifierController = app.get(AlarmsClassifierController);
  });

  it('classifies an alarm with an id and a known severity', () => {
    const result = alarmsClassifierController.classifyAlarm({
      name: 'smoke',
      buildingId: 1,
    });

    expect(result.id).toMatch(/^alarm-/);
    expect(['critical', 'major', 'minor', 'warning', 'info']).toContain(
      result.classification,
    );
  });
});
