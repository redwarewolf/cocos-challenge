import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Instrument } from './instrument.entity';
import { User } from './user.entity';

export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL',
  CASH_IN = 'CASH_IN',
  CASH_OUT = 'CASH_OUT',
}

export enum OrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
}

export enum OrderStatus {
  NEW = 'NEW',
  FILLED = 'FILLED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

@Entity({ name: 'orders' })
export class Order {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'instrumentid' })
  instrumentId: number;

  @ManyToOne(() => Instrument)
  @JoinColumn({ name: 'instrumentid' })
  instrument: Instrument;

  @Column({ name: 'userid' })
  userId: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userid' })
  user: User;

  @Column({ type: 'int' })
  size: number;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  price: string;

  @Column({ type: 'varchar', length: 10 })
  type: OrderType;

  @Column({ type: 'varchar', length: 10 })
  side: OrderSide;

  @Column({ type: 'varchar', length: 20 })
  status: OrderStatus;

  @Column({ type: 'timestamp' })
  datetime: Date;

  /**
   * Header `Idempotency-Key` opcional (issue #8): si un cliente reintenta un POST con
   * la misma key, se devuelve esta fila en vez de crear una orden duplicada. Columna
   * agregada vía migración aditiva, no forma parte del esquema original de Cocos.
   */
  @Column({
    name: 'idempotencykey',
    type: 'varchar',
    length: 255,
    nullable: true,
    unique: true,
  })
  idempotencyKey: string | null;
}
