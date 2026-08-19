import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateAndSaveSigningKey, loadSigningKey, SIGNING_KEY_RELATIVE_PATH } from './keys.js';

let tmpHome: string;
const originalHome = process.env.HOME;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harnesslens-keys-test-'));
  process.env.HOME = tmpHome;
});
afterEach(() => {
  process.env.HOME = originalHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('generateAndSaveSigningKey', () => {
  it('writes a signing-key.json with 0600 permissions and a 0700 parent directory', () => {
    const result = generateAndSaveSigningKey();
    const keyPath = path.join(tmpHome, SIGNING_KEY_RELATIVE_PATH);
    expect(fs.existsSync(keyPath)).toBe(true);
    expect(fs.statSync(keyPath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(keyPath)).mode & 0o777).toBe(0o700);
    expect(result.publicKeyBase64).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(Buffer.from(result.publicKeyBase64, 'base64').length).toBe(32);
  });

  it('never logs/returns the raw private key bytes in any printable summary field', () => {
    const result = generateAndSaveSigningKey();
    expect(Object.keys(result)).toEqual(['publicKeyBase64', 'keyFilePath']);
  });

  it('refuses to overwrite an existing key without force, fails loud with an actionable message', () => {
    generateAndSaveSigningKey();
    expect(() => generateAndSaveSigningKey()).toThrow(/already exists/i);
  });

  it('overwrites when force: true is passed', () => {
    const first = generateAndSaveSigningKey();
    const second = generateAndSaveSigningKey({ force: true });
    expect(second.publicKeyBase64).not.toBe(first.publicKeyBase64);
  });
});

describe('loadSigningKey', () => {
  it('loads a previously generated key and can produce a valid Ed25519 signature with it', () => {
    generateAndSaveSigningKey();
    const { privateKey } = loadSigningKey();
    expect(privateKey.asymmetricKeyType).toBe('ed25519');
  });

  it('throws an actionable error pointing at `harnesslens keygen` when no key file exists', () => {
    expect(() => loadSigningKey()).toThrow(/harnesslens keygen/);
  });
});
