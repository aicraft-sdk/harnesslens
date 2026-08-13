import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Repo } from '../../repos/entities/repo.entity';

// Insert-only: no update/delete repository method is ever exposed for this entity.
@Entity({ name: 'submissions' })
@Index(['repoId', 'scannedAt'])
export class Submission {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id!: string;

  @Column({ name: 'repo_id', type: 'uuid' })
  repoId!: string;

  @ManyToOne(() => Repo)
  @JoinColumn({ name: 'repo_id' })
  repo?: Repo;

  @Column({ type: 'numeric', precision: 5, scale: 2 })
  score!: string;

  @Column({ type: 'jsonb' })
  level!: unknown;

  @Column({ type: 'jsonb' })
  dimensions!: unknown;

  @Column({ name: 'framework_mapping', type: 'jsonb' })
  frameworkMapping!: unknown;

  @Column({ name: 'commit_sha', type: 'varchar', length: 40 })
  commitSha!: string;

  @Column({ name: 'scanned_at', type: 'timestamptz' })
  scannedAt!: Date;

  @Column({ type: 'boolean', default: false })
  verified!: boolean;

  @Column({ type: 'varchar', nullable: true })
  signature!: string | null;

  @Column({ name: 'key_id', type: 'varchar', nullable: true })
  keyId!: string | null;

  @CreateDateColumn({ name: 'submitted_at', type: 'timestamptz' })
  submittedAt!: Date;
}
