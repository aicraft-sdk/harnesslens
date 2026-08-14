import 'reflect-metadata';
import { IsIn } from 'class-validator';

export class UpdateRepoVisibilityDto {
  @IsIn(['public', 'private'])
  visibility!: 'public' | 'private';
}
