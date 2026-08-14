import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import { Repo } from './entities/repo.entity';

@Injectable()
export class ReposService {
  constructor(
    @InjectRepository(Account) private readonly accountsRepo: Repository<Account>,
    @InjectRepository(Repo) private readonly reposRepo: Repository<Repo>,
  ) {}

  /**
   * Auto-provisions an accounts row (org_name = the org segment of repoId) and a repos row
   * (visibility: 'public') on first basic-tier submission for a never-seen repoId, per Durable
   * Decision 6. Uses ON CONFLICT DO NOTHING upserts keyed on the unique columns (org_name,
   * repo_id) followed by a findOne, avoiding a race between concurrent first-submissions for the
   * same never-seen repo.
   */
  async findOrCreateForSubmission(repoId: string): Promise<Repo> {
    const orgName = repoId.split('/')[0];

    // Auto-provisioned accounts have no real API key yet -- Phase 3's POST /accounts is the only
    // path that ever issues one. This placeholder hash is derived from random bytes never
    // returned to any caller, so it can never match a presented bearer token.
    await this.accountsRepo
      .createQueryBuilder()
      .insert()
      .values({ orgName, apiKeyHash: randomBytes(32).toString('hex') })
      .orIgnore()
      .execute();
    const account = await this.accountsRepo.findOneByOrFail({ orgName });

    await this.reposRepo
      .createQueryBuilder()
      .insert()
      .values({ repoId, accountId: account.id, visibility: 'public' })
      .orIgnore()
      .execute();

    return this.reposRepo.findOneByOrFail({ repoId });
  }

  /** Lookup by the repo's own UUID primary key (used by the visibility-toggle endpoint). */
  async findById(id: string): Promise<Repo | null> {
    return this.reposRepo.findOneBy({ id });
  }

  /**
   * Lookup by the string `org/repo` identifier regardless of visibility -- used by the read
   * endpoints (Task 4.3) to resolve repo metadata (visibility, owning accountId) before deciding
   * whether to route to the public or private query path. Never returns submission data itself.
   */
  async findByRepoId(repoId: string): Promise<Repo | null> {
    return this.reposRepo.findOneBy({ repoId });
  }

  /** Scoped by the repo's own UUID id; the controller has already verified ownership. */
  async setVisibility(id: string, visibility: 'public' | 'private'): Promise<Repo> {
    await this.reposRepo.update({ id }, { visibility });
    return this.reposRepo.findOneByOrFail({ id });
  }
}
