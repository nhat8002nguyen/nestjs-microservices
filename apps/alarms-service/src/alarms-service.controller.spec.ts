import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';
import { AlarmsServiceController } from './alarms-service.controller';
import { AlarmsServiceService } from './alarms-service.service';
import { ALARMS_CLASSIFIER_SERVICE, NOTIFICATIONS_SERVICE } from './constants';

describe('AlarmsServiceController', () => {
  let controller: AlarmsServiceController;
  let alarmsClassifierService: { send: jest.Mock };
  let notificationsService: { emit: jest.Mock };

  beforeEach(async () => {
    alarmsClassifierService = {
      send: jest
        .fn()
        .mockReturnValue(of({ id: 'alarm-test123', classification: 'minor' })),
    };
    notificationsService = {
      emit: jest.fn().mockReturnValue(of(undefined)),
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AlarmsServiceController],
      providers: [
        AlarmsServiceService,
        {
          provide: ALARMS_CLASSIFIER_SERVICE,
          useValue: alarmsClassifierService,
        },
        { provide: NOTIFICATIONS_SERVICE, useValue: notificationsService },
      ],
    }).compile();

    controller = app.get<AlarmsServiceController>(AlarmsServiceController);
  });

  describe('createAlarm', () => {
    it('classifies the alarm and creates a notification', async () => {
      const alarm = { name: 'Alarm #test', buildingId: 42 };
      const result = await controller.createAlarm(alarm);

      expect(alarmsClassifierService.send).toHaveBeenCalledWith(
        'alarms.classify',
        alarm,
      );
      expect(notificationsService.emit).toHaveBeenCalledWith(
        'notifications.create',
        { alarmId: 'alarm-test123' },
      );
      expect(result).toEqual({
        id: 'alarm-test123',
        classification: 'minor',
      });
    });
  });
});
