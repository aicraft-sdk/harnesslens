import 'reflect-metadata';
import { IsArray, IsISO8601, IsNumber, IsObject, IsString, Matches, ValidateNested } from 'class-validator';
import { Exclude, Expose, Type } from 'class-transformer';

const REPO_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const SHA_RE = /^[0-9a-f]{7,40}$/i;
const SAFE_ID_RE = /^(?!__proto__$|constructor$|prototype$).+$/;

@Exclude()
class LevelDto {
  @Expose() @IsNumber() index!: number;
  @Expose() @IsString() name!: string;
}

@Exclude()
class DimensionDto {
  @Expose() @IsString() @Matches(SAFE_ID_RE) id!: string;
  @Expose() @IsString() title!: string;
  @Expose() @IsNumber() earned!: number;
  @Expose() @IsNumber() max!: number;
  @Expose() @IsNumber() percent!: number;
}

// @Exclude() at the class level means only @Expose()-decorated fields are copied onto the
// instance by plainToInstance, regardless of the caller's excludeExtraneousValues option — this
// is what keeps an "extra" field from ever landing on the DTO instance. forbidNonWhitelisted at
// the ValidationPipe layer (Task 1.4) rejects the raw request outright; this is the independent
// DTO-shape layer.
@Exclude()
export class CreateSubmissionDto {
  @Expose() @Matches(REPO_ID_RE) repoId!: string;
  @Expose() @IsNumber() score!: number;
  @Expose() @ValidateNested() @Type(() => LevelDto) level!: LevelDto;
  @Expose() @IsArray() @ValidateNested({ each: true }) @Type(() => DimensionDto) dimensions!: DimensionDto[];
  @Expose() @IsObject() frameworkMapping!: Record<string, { nistFunctions: string[]; owaspIds: string[] }>;
  @Expose() @Matches(SHA_RE) commitSha!: string;
  @Expose() @IsISO8601() scannedAt!: string;
  @Expose() keyId?: string; // present only for verified-tier submissions (Phase 3)
  @Expose() signature?: string; // present only for verified-tier submissions (Phase 3)
}
