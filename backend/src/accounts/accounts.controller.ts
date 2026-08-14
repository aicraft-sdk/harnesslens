import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateAccountDto) {
    const result = await this.accountsService.register(dto.orgName);
    return { accountId: result.accountId, apiKey: result.apiKey };
  }
}
