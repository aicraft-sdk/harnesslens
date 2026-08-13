import { Body, Controller, ForbiddenException, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/api-key.guard';
import type { Account } from '../accounts/entities/account.entity';
import { RegisterSigningKeyDto } from './dto/register-signing-key.dto';
import { SigningKeysService } from './signing-keys.service';

interface RequestWithAccount {
  account?: Account;
}

@Controller('accounts/:accountId/signing-keys')
@UseGuards(ApiKeyGuard)
export class SigningKeysController {
  constructor(private readonly signingKeysService: SigningKeysService) {}

  @Post()
  @HttpCode(201)
  async create(
    @Param('accountId') accountId: string,
    @Body() dto: RegisterSigningKeyDto,
    @Req() req: RequestWithAccount,
  ) {
    // Tenant-isolation layer (a): the authenticated account (attached by ApiKeyGuard) must match
    // the :accountId route param -- re-used identically for Phase 4's private-tier endpoints.
    if (req.account?.id !== accountId) {
      throw new ForbiddenException('accountId does not match the authenticated account');
    }
    return this.signingKeysService.register(accountId, dto.publicKey);
  }
}
