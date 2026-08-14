import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
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
// Espeja la constraint real de la DB (ver migración ScopeIdempotencyKeyToUser). Con
// `synchronize: false` esto no crea nada: es metadata, y desactualizarla haría que la
// entity describa un esquema que no existe.
@Unique('uq_orders_userid_idempotencykey', ['userId', 'idempotencyKey'])
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
   *
   * La unicidad es por usuario (ver `@Unique` en la clase), no global: la key identifica
   * un intento de un usuario puntual, y dos cuentas distintas pueden elegir la misma.
   */
  @Column({
    name: 'idempotencykey',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  idempotencyKey: string | null;
}
