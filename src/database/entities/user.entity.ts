import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string;

  @Column({
    name: 'accountnumber',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  accountNumber: string;
}
