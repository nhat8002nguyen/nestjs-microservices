import { Module } from '@nestjs/common';
import { InboxModule } from '@app/inbox/inbox.module';
import { CreateWorkflowDto } from '@app/workflows';
import { WorkflowsServiceController } from './workflows-service.controller';
import { WorkflowsServiceService } from './workflows-service.service';
import { HealthModule } from './health/health.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { WorkflowsService } from './workflows/workflows.service';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.POSTGRES_HOST ?? 'workflows-db',
      port: parseInt(process.env.POSTGRES_PORT ?? '5432'),
      username: process.env.POSTGRES_USER ?? 'postgres',
      password: process.env.POSTGRES_PASSWORD ?? 'postgres',
      database: process.env.POSTGRES_DB ?? 'workflows',
      autoLoadEntities: true,
      synchronize: process.env.NODE_ENV === 'development',
    }),
    WorkflowsModule,
    HealthModule,
    InboxModule.registerAsync({
      imports: [WorkflowsModule],
      inject: [WorkflowsService],
      useFactory: (workflowsService: WorkflowsService) => ({
        redis: {
          host: process.env.REDIS_HOST ?? 'redis',
          port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
        },
        repeatEveryMs: 10_000,
        take: 100,
        maxAttempts: 3,
        handlers: {
          'workflows.create': async (payload, em) => {
            await workflowsService.create(payload as CreateWorkflowDto, em);
          },
        },
      }),
    }),
  ],
  controllers: [WorkflowsServiceController],
  providers: [WorkflowsServiceService],
})
export class WorkflowsServiceModule {}
