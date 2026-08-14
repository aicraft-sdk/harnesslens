import { Controller, Get, NotFoundException, Param, Req, UseGuards } from '@nestjs/common';
import { OptionalApiKeyGuard } from '../auth/optional-api-key.guard';
import type { Account } from '../accounts/entities/account.entity';
import { ReposService } from '../repos/repos.service';
import { QueryResultRow, QueryService } from './query.service';

interface RequestWithAccount {
  account?: Account;
}

@Controller('repos')
export class QueryController {
  constructor(
    private readonly queryService: QueryService,
    private readonly reposService: ReposService,
  ) {}

  @Get()
  async listPublic() {
    return this.queryService.listPublicLatest();
  }

  // repoId is always "org/repo" (Task 1.1's REPO_ID_RE), so it is captured as two path segments
  // and rebuilt server-side -- a single :repoId segment cannot match a value containing "/".
  @Get(':org/:repo')
  @UseGuards(OptionalApiKeyGuard)
  async getOne(@Param('org') org: string, @Param('repo') repo: string, @Req() req: RequestWithAccount) {
    const history = await this.resolvePrivateAwareHistory(`${org}/${repo}`, req.account);
    if (!history || history.length === 0) {
      // Argument-less NotFoundException so the private-repo (never existed, wrong account, or
      // unauthenticated) and never-existed cases produce an identical response shape (status,
      // body, headers) -- deliberate, load-bearing (see QueryService.getLatestForRepo).
      throw new NotFoundException();
    }
    return history[0];
  }

  @Get(':org/:repo/history')
  @UseGuards(OptionalApiKeyGuard)
  async getHistory(@Param('org') org: string, @Param('repo') repo: string, @Req() req: RequestWithAccount) {
    const history = await this.resolvePrivateAwareHistory(`${org}/${repo}`, req.account);
    if (!history) {
      throw new NotFoundException();
    }
    return history;
  }

  /**
   * Resolves to `null` when the repo doesn't exist at all, or when it is private and the
   * authenticated account (if any) doesn't own it -- callers must treat both the same way (404,
   * identical shape). Resolves to `[]` only for a public repo with no submissions yet -- history
   * endpoints already return `[]` in that case (unchanged from Task 2.2), so folding it into the
   * same "no rows" branch as the detail endpoint's not-found check is intentional.
   *
   * Public repos are always served through the existing Task 2.2 query path
   * (`getHistoryForRepo`); private repos are only ever served through `getPrivateHistory` (tenant
   * isolation layer (b)) and only once the caller's account is confirmed to own the repo (layer
   * (a)) -- exactly one query executes before either 404 branch below returns, so a
   * never-existed repoId and a private repoId the caller doesn't own take the same number of DB
   * round trips and can't be distinguished by timing either.
   */
  private async resolvePrivateAwareHistory(
    repoId: string,
    account: Account | undefined,
  ): Promise<QueryResultRow[] | null> {
    const repoMeta = await this.reposService.findByRepoId(repoId);
    if (!repoMeta) {
      return null;
    }
    if (repoMeta.visibility === 'public') {
      return (await this.queryService.getHistoryForRepo(repoId)) ?? [];
    }
    if (!account || account.id !== repoMeta.accountId) {
      return null;
    }
    return this.queryService.getPrivateHistory(repoId, account.id);
  }
}
