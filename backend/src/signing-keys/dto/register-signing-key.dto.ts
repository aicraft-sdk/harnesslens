import 'reflect-metadata';
import { IsString, Validate, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

const ED25519_PUBLIC_KEY_BYTES = 32;
// Reject anything containing a character outside the base64 alphabet up front -- Buffer.from(...,
// 'base64') silently ignores invalid characters instead of throwing, so a naive
// decode-then-check-length approach would accept garbage strings that merely happen to decode to
// 32 bytes after Node drops the invalid characters.
const BASE64_CHARSET_RE = /^[A-Za-z0-9+/]+={0,2}$/;

@ValidatorConstraint({ name: 'isEd25519PublicKeyBase64', async: false })
class IsEd25519PublicKeyBase64Constraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string' || !BASE64_CHARSET_RE.test(value)) {
      return false;
    }
    return Buffer.from(value, 'base64').length === ED25519_PUBLIC_KEY_BYTES;
  }

  defaultMessage(): string {
    return `publicKey must be a base64-encoded raw Ed25519 public key (${ED25519_PUBLIC_KEY_BYTES} bytes)`;
  }
}

export class RegisterSigningKeyDto {
  @IsString()
  @Validate(IsEd25519PublicKeyBase64Constraint)
  publicKey!: string;
}
