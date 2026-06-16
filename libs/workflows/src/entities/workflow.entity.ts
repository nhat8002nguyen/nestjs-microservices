import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Workflow {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  buildingId: number;

  @Column()
  name: string;
}
