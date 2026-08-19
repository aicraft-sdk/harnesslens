/**
 * Ed25519 signing-key generation and key-file I/O for the CLI's `harnesslens keygen` command
 * (Phase 4). Pure `node:crypto` + `node:fs`/`node:os`/`node:path` only — zero new dependencies.
 * See `docs/plans/2026-08-19-evidence-package-plan.md` Phase 4 for the design rationale.
 */

import { createPrivateKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const SIGNING_KEY_RELATIVE_PATH = path.join('.harnesslens', 'signing-key.json');

interface SigningKeyFile {
  algorithm: 'ed25519';
  privateKeyPkcs8Base64: string;
  publicKeyBase64: string;
  createdAt: string;
}

export interface GenerateSigningKeyResult {
  publicKeyBase64: string;
  keyFilePath: string;
}

function rawPublicKeyBase64(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  return Buffer.from(jwk.x, 'base64url').toString('base64');
}

function keyFilePath(): string {
  return path.join(os.homedir(), SIGNING_KEY_RELATIVE_PATH);
}

/** Generates an Ed25519 keypair and writes the private key to ~/.harnesslens/signing-key.json
 * (0600), creating the parent directory (0700) if needed. Never overwrites an existing key unless
 * `force: true` is explicitly passed -- losing a signing key silently would be unrecoverable for
 * whatever it was previously registered under. */
export function generateAndSaveSigningKey(opts: { force?: boolean } = {}): GenerateSigningKeyResult {
  const filePath = keyFilePath();
  if (fs.existsSync(filePath) && !opts.force) {
    throw new Error(`A signing key already exists at ${filePath}. Pass --force to overwrite it.`);
  }

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const fileContents: SigningKeyFile = {
    algorithm: 'ed25519',
    privateKeyPkcs8Base64: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    publicKeyBase64: rawPublicKeyBase64(publicKey),
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(filePath, JSON.stringify(fileContents, null, 2), { mode: 0o600 });
  // Explicitly chmod after write too: writeFileSync's `mode` option is only honored on file
  // *creation* -- if a prior write left looser permissions (e.g. --force overwrite of a file
  // whose mode had drifted), this guarantees 0600 regardless.
  fs.chmodSync(filePath, 0o600);

  return { publicKeyBase64: fileContents.publicKeyBase64, keyFilePath: filePath };
}

export interface LoadedSigningKey {
  privateKey: KeyObject;
  publicKeyBase64: string;
}

/** Never throws a raw fs error -- always a message pointing at `harnesslens keygen`. */
export function loadSigningKey(): LoadedSigningKey {
  const filePath = keyFilePath();
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    throw new Error(
      `No signing key found at ${filePath}. Run \`harnesslens keygen\` first, then register the printed public key.`,
    );
  }
  const parsed = JSON.parse(raw) as SigningKeyFile;
  const privateKey = createPrivateKey({
    key: Buffer.from(parsed.privateKeyPkcs8Base64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  return { privateKey, publicKeyBase64: parsed.publicKeyBase64 };
}
