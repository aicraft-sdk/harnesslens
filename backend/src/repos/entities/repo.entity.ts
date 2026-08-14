import { Check, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Account } from '../../accounts/entities/account.entity';

@Entity({ name: 'repos' })
@Check(`"visibility" IN ('public', 'private')`)
export class Repo {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id!: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @ManyToOne(() => Account)
  @JoinColumn({ name: 'account_id' })
  account?: Account;

  @Column({ name: 'repo_id', type: 'varchar', unique: true })
  repoId!: string;

  @Column({ type: 'varchar', length: 7, default: 'public' })
  visibility!: 'public' | 'private';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
