import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Instrument } from './instrument.entity';

@Entity({ name: 'marketdata' })
export class MarketData {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'instrumentid' })
  instrumentId: number;

  @ManyToOne(() => Instrument)
  @JoinColumn({ name: 'instrumentid' })
  instrument: Instrument;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  high: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  low: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  open: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  close: string;

  @Column({
    name: 'previousclose',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  previousClose: string;

  @Column({ type: 'date' })
  date: string;
}
