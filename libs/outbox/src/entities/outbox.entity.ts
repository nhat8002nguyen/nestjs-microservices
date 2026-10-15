import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
@Index(['target', 'status', 'createdAt'])
export class Outbox {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  type: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, any>;

  @Column()
  target: string;

  @Column({
    type: 'enum',
    enum: ['pending', 'processed'],
    default: 'pending',
  })
  status: 'pending' | 'processed';

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
