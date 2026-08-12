import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum InstrumentType {
  ACCIONES = 'ACCIONES',
  MONEDA = 'MONEDA',
}

@Entity({ name: 'instruments' })
export class Instrument {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 10, nullable: true })
  ticker: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  type: InstrumentType;
}
