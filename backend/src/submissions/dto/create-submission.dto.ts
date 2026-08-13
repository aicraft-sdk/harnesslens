import 'reflect-metadata';
import { IsArray, IsISO8601, IsNumber, IsObject, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

const REPO_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const SHA_RE = /^[0-9a-f]{7,40}$/i;
const SAFE_ID_RE = /^(?!__proto__$|constructor$|prototype$).+$/;

class LevelDto {
  @IsNumber() index!: number;
  @IsString() name!: string;
}

class DimensionDto {
  @IsString() @Matches(SAFE_ID_RE) id!: string;
  @IsString() title!: string;
  @IsNumber() earned!: number;
  @IsNumber() max!: number;
  @IsNumber() percent!: number;
}

// Deliberately no class-level @Exclude()/@Expose(): NestJS's ValidationPipe reuses this same
// class-transformer strategy internally when it builds the instance to validate, so a class-level
// @Exclude() would silently strip an "extra" field before class-validator's own
// whitelist/forbidNonWhitelisted check ever saw it -- defeating the "reject with 400, never
// silently drop" requirement at the HTTP layer. Rejection of unknown top-level fields is enforced
// entirely by class-validator's whitelist/forbidNonWhitelisted (every known field below has its
// own validation decorator, so those are exactly the fields whitelisted).
export class CreateSubmissionDto {
  @Matches(REPO_ID_RE) repoId!: string;
  @IsNumber() score!: number;
  @ValidateNested() @Type(() => LevelDto) level!: LevelDto;
  @IsArray() @ValidateNested({ each: true }) @Type(() => DimensionDto) dimensions!: DimensionDto[];
  @IsObject() frameworkMapping!: Record<string, { nistFunctions: string[]; owaspIds: string[] }>;
  @Matches(SHA_RE) commitSha!: string;
  @IsISO8601() scannedAt!: string;
  // @IsOptional() registers class-validator metadata for these fields -- without any validation
  // decorator at all, whitelist/forbidNonWhitelisted wouldn't recognize keyId/signature as known
  // DTO properties and would reject basic-tier submissions that correctly omit them.
  @IsOptional() @IsString() keyId?: string; // present only for verified-tier submissions (Phase 3)
  @IsOptional() @IsString() signature?: string; // present only for verified-tier submissions (Phase 3)
}
