import { Module } from '@nestjs/common';
import { WorkflowsServiceController } from './workflows-service.controller';
import { WorkflowsServiceService } from './workflows-service.service';
import { HealthModule } from './health/health.module';
import { WorkflowsModule } from './workflows/workflows.module';
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
  ],
  controllers: [WorkflowsServiceController],
  providers: [WorkflowsServiceService],
})
export class WorkflowsServiceModule {}
