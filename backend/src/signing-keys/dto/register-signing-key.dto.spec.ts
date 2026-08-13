import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { describe, it, expect } from 'vitest';
import { RegisterSigningKeyDto } from './register-signing-key.dto';

// A genuine base64-encoded 32-byte Ed25519 public key (reused across signing-keys e2e specs).
const validPublicKeyBase64 = 'QIzp4l41mSRXOuI9o/eZsymtnu0iJx9mcQyXpaOGkws=';

describe('RegisterSigningKeyDto', () => {
  it('accepts a base64-encoded 32-byte Ed25519 public key', async () => {
    const dto = plainToInstance(RegisterSigningKeyDto, { publicKey: validPublicKeyBase64 });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a publicKey that is not valid base64', async () => {
    const dto = plainToInstance(RegisterSigningKeyDto, { publicKey: 'not-valid-base64!!!' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a well-formed base64 string that decodes to the wrong byte length (too short)', async () => {
    // Valid base64, but only decodes to 3 bytes -- nowhere near the required 32.
    const dto = plainToInstance(RegisterSigningKeyDto, { publicKey: 'QUJD' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a well-formed base64 string that decodes to the wrong byte length (33 bytes)', async () => {
    const dto = plainToInstance(RegisterSigningKeyDto, {
      publicKey: Buffer.alloc(33, 7).toString('base64'),
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
