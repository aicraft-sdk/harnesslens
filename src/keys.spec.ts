import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateAndSaveSigningKey, loadSigningKey, SIGNING_KEY_RELATIVE_PATH } from './keys.js';

// `node:fs` is a native ESM module -- its named exports can't be spied on directly with
// `vi.spyOn`. Wrapping `existsSync` in a `vi.fn` that forwards to the real implementation by
// default lets a single test simulate a TOCTOU race window (see below) without changing behavior
// for every other test in this file.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

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

  it('restores drifted parent directory permissions to 0700 on a --force overwrite (mirrors the file chmod guarantee)', () => {
    generateAndSaveSigningKey();
    const keyPath = path.join(tmpHome, SIGNING_KEY_RELATIVE_PATH);
    const dirPath = path.dirname(keyPath);
    // Simulate permission drift on both the file and its parent directory.
    fs.chmodSync(dirPath, 0o755);
    fs.chmodSync(keyPath, 0o644);

    generateAndSaveSigningKey({ force: true });

    expect(fs.statSync(keyPath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(dirPath).mode & 0o777).toBe(0o700);
  });

  it('still refuses to overwrite when the existsSync pre-check races past a concurrent writer (TOCTOU), enforced at the OS level', () => {
    generateAndSaveSigningKey();
    // Simulate the race window: a concurrent `keygen` invocation observes "no file yet" even
    // though one now exists on disk by the time this call actually writes.
    vi.mocked(fs.existsSync).mockReturnValueOnce(false);

    expect(() => generateAndSaveSigningKey()).toThrow(/already exists/i);
  });

  it('surfaces an actionable error, not a raw fs error, when ~/.harnesslens is blocked by a non-directory file', () => {
    const blockedDirPath = path.join(tmpHome, '.harnesslens');
    fs.writeFileSync(blockedDirPath, 'not a directory');

    expect(() => generateAndSaveSigningKey()).toThrow(/harnesslens keygen/i);
  });

  it('surfaces an actionable error, not a raw fs error, when the --force write target is itself a directory', () => {
    const keyPath = path.join(tmpHome, SIGNING_KEY_RELATIVE_PATH);
    fs.mkdirSync(keyPath, { recursive: true });

    expect(() => generateAndSaveSigningKey({ force: true })).toThrow(/harnesslens keygen/i);
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

  it('throws an actionable error pointing at `harnesslens keygen --force` when the key file is corrupt JSON', () => {
    const keyPath = path.join(tmpHome, SIGNING_KEY_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(keyPath, 'not valid json{{{', { mode: 0o600 });

    expect(() => loadSigningKey()).toThrow(/harnesslens keygen --force/);
  });

  it('throws an actionable error pointing at `harnesslens keygen --force` when the key file has valid JSON but a tampered/invalid PKCS8 payload', () => {
    const keyPath = path.join(tmpHome, SIGNING_KEY_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      keyPath,
      JSON.stringify({
        algorithm: 'ed25519',
        privateKeyPkcs8Base64: Buffer.from('not a real pkcs8 key').toString('base64'),
        publicKeyBase64: 'AAAA',
        createdAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );

    expect(() => loadSigningKey()).toThrow(/harnesslens keygen --force/);
  });
});
