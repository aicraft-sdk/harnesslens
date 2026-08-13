import 'reflect-metadata';
import { IsString } from 'class-validator';

export class RegisterSigningKeyDto {
  @IsString() publicKey!: string;
}
