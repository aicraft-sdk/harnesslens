import 'reflect-metadata';
import { IsString } from 'class-validator';

export class CreateAccountDto {
  @IsString() orgName!: string;
}
