import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Account } from '../../accounts/entities/account.entity';

@Entity({ name: 'signing_keys' })
export class SigningKey {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id!: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @ManyToOne(() => Account)
  @JoinColumn({ name: 'account_id' })
  account?: Account;

  @Column({ name: 'public_key', type: 'varchar' })
  publicKey!: string;

  @Column({ name: 'key_id', type: 'varchar', unique: true })
  keyId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;
}
