import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'rejected_submissions' })
export class RejectedSubmission {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id!: string;

  @Column({ name: 'payload_hash', type: 'varchar' })
  payloadHash!: string;

  @Column({ type: 'varchar' })
  reason!: string;

  @CreateDateColumn({ name: 'rejected_at', type: 'timestamptz' })
  rejectedAt!: Date;
}
