import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/entities/account.entity';
import { SigningKey } from './entities/signing-key.entity';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { SigningKeysController } from './signing-keys.controller';
import { SigningKeysService } from './signing-keys.service';

@Module({
  imports: [TypeOrmModule.forFeature([Account, SigningKey])],
  controllers: [SigningKeysController],
  providers: [SigningKeysService, ApiKeyGuard],
})
export class SigningKeysModule {}
