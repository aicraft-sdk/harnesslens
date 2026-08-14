import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/entities/account.entity';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { Repo } from './entities/repo.entity';
import { ReposController } from './repos.controller';
import { ReposService } from './repos.service';

@Module({
  imports: [TypeOrmModule.forFeature([Account, Repo])],
  controllers: [ReposController],
  providers: [ReposService, ApiKeyGuard],
})
export class ReposModule {}
