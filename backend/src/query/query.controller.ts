import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { QueryService } from './query.service';

@Controller('repos')
export class QueryController {
  constructor(private readonly queryService: QueryService) {}

  @Get()
  async listPublic() {
    return this.queryService.listPublicLatest();
  }

  // repoId is always "org/repo" (Task 1.1's REPO_ID_RE), so it is captured as two path segments
  // and rebuilt server-side -- a single :repoId segment cannot match a value containing "/".
  @Get(':org/:repo')
  async getOne(@Param('org') org: string, @Param('repo') repo: string) {
    const result = await this.queryService.getLatestForRepo(`${org}/${repo}`);
    if (!result) {
      // Argument-less NotFoundException so the private-repo and never-existed cases produce an
      // identical response shape (status, body, headers) -- deliberate, load-bearing (see
      // QueryService.getLatestForRepo).
      throw new NotFoundException();
    }
    return result;
  }

  @Get(':org/:repo/history')
  async getHistory(@Param('org') org: string, @Param('repo') repo: string) {
    const result = await this.queryService.getHistoryForRepo(`${org}/${repo}`);
    if (!result) {
      throw new NotFoundException();
    }
    return result;
  }
}
