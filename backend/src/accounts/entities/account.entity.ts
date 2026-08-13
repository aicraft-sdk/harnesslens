import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'accounts' })
export class Account {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id!: string;

  @Column({ name: 'org_name', type: 'varchar', unique: true })
  orgName!: string;

  @Column({ name: 'api_key_hash', type: 'varchar', unique: true })
  apiKeyHash!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
