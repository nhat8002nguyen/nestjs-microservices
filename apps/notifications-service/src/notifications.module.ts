import { TracingModule } from '@app/tracing';
import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';

@Module({
  imports: [TracingModule],
  controllers: [NotificationsController],
})
export class NotificationsModule {}
