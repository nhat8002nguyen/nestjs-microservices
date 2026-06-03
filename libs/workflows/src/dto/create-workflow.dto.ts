import { IsNumber, IsString } from 'class-validator';

export class CreateWorkflowDto {
  @IsNumber()
  buildingId: number;

  @IsString()
  name: string;
}
