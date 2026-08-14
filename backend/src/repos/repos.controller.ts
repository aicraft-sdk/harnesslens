import {
  Body,
  Controller,
  ForbiddenException,
  NotFoundException,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '../auth/api-key.guard';
import type { Account } from '../accounts/entities/account.entity';
import { UpdateRepoVisibilityDto } from './dto/update-repo-visibility.dto';
import { ReposService } from './repos.service';

interface RequestWithAccount {
  account?: Account;
}

@Controller('accounts/:accountId/repos')
@UseGuards(ApiKeyGuard)
export class ReposController {
  constructor(private readonly reposService: ReposService) {}

  @Patch(':repoId/visibility')
  async updateVisibility(
    @Param('accountId') accountId: string,
    @Param('repoId') repoId: string,
    @Body() dto: UpdateRepoVisibilityDto,
    @Req() req: RequestWithAccount,
  ) {
    // Tenant-isolation layer (a), part 1: the route's :accountId must match the authenticated
    // account -- matches the SigningKeysController convention for account-scoped write endpoints.
    if (req.account?.id !== accountId) {
      throw new ForbiddenException('accountId does not match the authenticated account');
    }

    const repo = await this.reposService.findById(repoId);
    if (!repo) {
      throw new NotFoundException();
    }

    // Tenant-isolation layer (a), part 2: bind directly to the resource's own accountId (the
    // plan's literal check: repo.accountId === request.account.id), not just the URL the caller
    // chose to type -- redundant with the check above given the URL structure, but this is the
    // check that actually matters if that structure ever changes.
    if (repo.accountId !== req.account.id) {
      throw new ForbiddenException('accountId does not match the authenticated account');
    }

    const updated = await this.reposService.setVisibility(repo.id, dto.visibility);
    return { repoId: updated.repoId, visibility: updated.visibility };
  }
}
