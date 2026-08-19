import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from './cli.js';
import { buildCanonicalPayload, type CanonicalSubmissionFields } from './canonical-payload.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, '../test/fixtures');
const LEVEL_2_FIXTURE = path.join(FIXTURES_ROOT, 'level-2');
const LEVEL_0_FIXTURE = path.join(FIXTURES_ROOT, 'level-0');
const LEVEL_4_FIXTURE = path.join(FIXTURES_ROOT, 'level-4');

function makeIO() {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  return {
    stdoutLines,
    stderrLines,
    io: {
      stdout: (s: string) => {
        stdoutLines.push(s);
        return true;
      },
      stderr: (s: string) => {
        stderrLines.push(s);
        return true;
      },
    },
  };
}

describe('harnesslens CLI — default terminal output', () => {
  it('renders a terminal report for --root <fixture> and exits 0', async () => {
    const { io, stdoutLines } = makeIO();

    const result = await main(['--root', LEVEL_2_FIXTURE], io);

    expect(result.exitCode).toBe(0);
    const output = stdoutLines.join('');
    expect(output).toContain('harnesslens v');
    expect(output).toContain('Maturity:');
  });

  it('accepts a positional root argument (no --root flag)', async () => {
    const { io, stdoutLines } = makeIO();

    const result = await main([LEVEL_2_FIXTURE], io);

    expect(result.exitCode).toBe(0);
    expect(stdoutLines.join('')).toContain('Maturity:');
  });

  it('defaults root to process.cwd() when no root/path is given', async () => {
    const { io, stdoutLines } = makeIO();
    const cwdBefore = process.cwd();
    process.chdir(LEVEL_2_FIXTURE);
    try {
      const result = await main([], io);
      expect(result.exitCode).toBe(0);
      expect(stdoutLines.join('')).toContain('Maturity:');
    } finally {
      process.chdir(cwdBefore);
    }
  });

  it('errors with exit 1 and a message on stderr when .harness-audit.json is invalid JSON', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harnesslens-cli-badconfig-'));
    try {
      fs.writeFileSync(path.join(dir, '.harness-audit.json'), '{ not valid json');
      const { io, stderrLines } = makeIO();

      const result = await main(['--root', dir], io);

      expect(result.exitCode).toBe(1);
      expect(stderrLines.join('')).toContain('harnesslens:');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('harnesslens CLI — --json', () => {
  it('prints a valid JSON Report with the expected top-level shape', async () => {
    const { io, stdoutLines } = makeIO();

    const result = await main(['--root', LEVEL_2_FIXTURE, '--json'], io);

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(stdoutLines.join(''));
    expect(report.tool).toEqual({ name: 'harnesslens', version: expect.any(String) });
    expect(typeof report.level.index).toBe('number');
    expect(typeof report.score.percent).toBe('number');
    expect(Array.isArray(report.checks)).toBe(true);
  });
});

describe('harnesslens CLI — --md', () => {
  it('prints a markdown report starting with the report heading', async () => {
    const { io, stdoutLines } = makeIO();

    const result = await main(['--root', LEVEL_2_FIXTURE, '--md'], io);

    expect(result.exitCode).toBe(0);
    expect(stdoutLines.join('')).toContain('# HarnessLens Report');
  });
});

describe('harnesslens CLI — --badge', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harnesslens-cli-badge-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes an SVG badge file to the given path', async () => {
    const { io } = makeIO();
    const badgePath = path.join(dir, 'badge.svg');

    const result = await main(['--root', LEVEL_2_FIXTURE, '--badge', badgePath], io);

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(badgePath)).toBe(true);
    expect(fs.readFileSync(badgePath, 'utf8')).toContain('<svg');
  });

  it('exits 1 with a stderr message when the badge path is unwritable (missing parent dir)', async () => {
    const { io, stderrLines } = makeIO();
    const badgePath = path.join(dir, 'no-such-subdir', 'badge.svg');

    const result = await main(['--root', LEVEL_2_FIXTURE, '--badge', badgePath], io);

    expect(result.exitCode).toBe(1);
    expect(stderrLines.join('')).toContain('badge');
  });
});

describe('harnesslens CLI — --min-level', () => {
  it('exits 0 when --min-level is at or below the report level', async () => {
    const { io } = makeIO();

    const result = await main(['--root', LEVEL_2_FIXTURE, '--min-level', '0'], io);

    expect(result.exitCode).toBe(0);
  });

  it('exits 1 when --min-level is above the report level', async () => {
    const { io } = makeIO();

    const result = await main(['--root', LEVEL_2_FIXTURE, '--min-level', '5'], io);

    expect(result.exitCode).toBe(1);
  });
});

describe('harnesslens CLI — multi subcommand', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harnesslens-cli-multi-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('audits every repo in the manifest and prints an aggregate JSON scorecard', async () => {
    const { io, stdoutLines } = makeIO();
    const manifestPath = path.join(dir, 'repos.json');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ repos: [{ id: 'zero', path: LEVEL_0_FIXTURE }, { id: 'four', path: LEVEL_4_FIXTURE }] }),
    );

    const result = await main(['multi', '--config', manifestPath, '--json'], io);

    expect(result.exitCode).toBe(0);
    const aggregate = JSON.parse(stdoutLines.join(''));
    expect(aggregate.results).toHaveLength(2);
    expect(aggregate.results.map((r: { id: string }) => r.id)).toEqual(['zero', 'four']);
    expect(aggregate.rollup.repoCount).toBe(2);
  });

  it('running the multi command twice on the same manifest produces byte-identical --json stdout', async () => {
    const manifestPath = path.join(dir, 'repos.json');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ repos: [{ id: 'zero', path: LEVEL_0_FIXTURE }, { id: 'four', path: LEVEL_4_FIXTURE }] }),
    );

    const first = makeIO();
    const second = makeIO();

    await main(['multi', '--config', manifestPath, '--json'], first.io);
    await main(['multi', '--config', manifestPath, '--json'], second.io);

    expect(first.stdoutLines.join('')).toBe(second.stdoutLines.join(''));
  });

  it('errors with exit 1 when --config is missing', async () => {
    const { io, stderrLines } = makeIO();

    const result = await main(['multi'], io);

    expect(result.exitCode).toBe(1);
    expect(stderrLines.join('')).toContain('--config');
  });
});

describe('harnesslens CLI — --help', () => {
  it('prints usage and exits 0', async () => {
    const { io, stdoutLines } = makeIO();

    const result = await main(['--help'], io);

    expect(result.exitCode).toBe(0);
    expect(stdoutLines.join('')).toContain('Usage:');
  });
});

describe('harnesslens keygen', () => {
  let tmpHome: string;
  const originalHome = process.env.HOME;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harnesslens-cli-keygen-test-'));
    process.env.HOME = tmpHome;
  });
  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('prints the public key and a registration command, exits 0', async () => {
    const { io, stdoutLines } = makeIO();
    const result = await main(['keygen'], io);
    expect(result.exitCode).toBe(0);
    const out = stdoutLines.join('');
    expect(out).toContain('Public key (base64):');
    expect(out).toContain('signing-keys');
    expect(out).not.toMatch(/private/i); // never print the word "private key" value itself
  });

  it('exits 1 with an actionable message when a key already exists and --force is not passed', async () => {
    const { io: io1 } = makeIO();
    await main(['keygen'], io1);
    const { io: io2, stderrLines } = makeIO();
    const result = await main(['keygen'], io2);
    expect(result.exitCode).toBe(1);
    expect(stderrLines.join('')).toMatch(/already exists/i);
  });
});

describe('harnesslens submit --sign', () => {
  let tmpHome: string;
  const originalHome = process.env.HOME;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harnesslens-cli-submit-test-'));
    process.env.HOME = tmpHome;
  });
  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('POSTs the signed body to <api-url>/submissions and prints the returned submission id', async () => {
    const { io } = makeIO();
    await main(['keygen'], io);
    const { io: submitIo, stdoutLines } = makeIO();
    const fakeFetch = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 'sub-1', verified: true }) });

    const result = await main(
      ['submit', LEVEL_2_FIXTURE, '--sign', '--repo-id', 'acme/widgets', '--commit-sha', 'a1b2c3d', '--key-id', 'key-1', '--api-url', 'http://localhost:3000'],
      submitIo, { fetchImpl: fakeFetch },
    );

    expect(result.exitCode).toBe(0);
    expect(fakeFetch).toHaveBeenCalledWith('http://localhost:3000/submissions', expect.objectContaining({ method: 'POST' }));
    expect(stdoutLines.join('')).toContain('sub-1');
  });

  it('exits 1 with an actionable error when --sign is omitted (Durable Decision 9)', async () => {
    const { io, stderrLines } = makeIO();

    const result = await main(['submit', LEVEL_2_FIXTURE, '--repo-id', 'acme/widgets', '--commit-sha', 'a1b2c3d'], io);

    expect(result.exitCode).toBe(1);
    expect(stderrLines.join('')).toMatch(/--sign/);
  });

  it('exits 1 with an actionable error when no local signing key exists', async () => {
    const { io, stderrLines } = makeIO();

    const result = await main(
      ['submit', LEVEL_2_FIXTURE, '--sign', '--repo-id', 'acme/widgets', '--commit-sha', 'a1b2c3d', '--key-id', 'key-1', '--api-url', 'http://x'],
      io,
    );

    expect(result.exitCode).toBe(1);
    expect(stderrLines.join('')).toMatch(/harnesslens keygen/);
  });

  it('exits 1 when the server rejects the submission (e.g. 400), surfacing the server\'s reason', async () => {
    const { io } = makeIO();
    await main(['keygen'], io);
    const { io: submitIo, stderrLines } = makeIO();
    const fakeFetch = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'invalid signature' }) });

    const result = await main(
      ['submit', LEVEL_2_FIXTURE, '--sign', '--repo-id', 'acme/widgets', '--commit-sha', 'a1b2c3d', '--key-id', 'key-1', '--api-url', 'http://x'],
      submitIo, { fetchImpl: fakeFetch },
    );

    expect(result.exitCode).toBe(1);
    expect(stderrLines.join('')).toContain('invalid signature');
  });
});

describe('harnesslens verify-package', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const rawPublicKeyBase64 = Buffer.from(
    (publicKey.export({ format: 'jwk' }) as { x: string }).x,
    'base64url',
  ).toString('base64');
  const fields: CanonicalSubmissionFields = {
    repoId: 'acme/widgets', score: 80, level: { index: 3, name: 'L3' },
    dimensions: [], frameworkMapping: {}, commitSha: 'a1b2c3d', scannedAt: '2026-08-13T00:00:00.000Z',
  };
  const signature = sign(null, Buffer.from(buildCanonicalPayload(fields), 'utf8'), privateKey).toString('base64');
  const validEvidence = {
    ...fields, id: 'sub-1', verified: true, signature, keyId: 'key-1', publicKey: rawPublicKeyBase64, checks: null,
  };
  const tamperedEvidence = { ...validEvidence, commitSha: 'TAMPERED' };

  it('prints "signature VALID" and exits 0 for a valid package', async () => {
    const { io, stdoutLines } = makeIO();
    const fakeFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => validEvidence });
    const result = await main(['verify-package', 'sub-1', '--api-url', 'http://x'], io, { fetchImpl: fakeFetch });
    expect(result.exitCode).toBe(0);
    expect(stdoutLines.join('')).toContain('signature VALID');
  });

  it('prints "signature INVALID" and exits 1 for a tampered package', async () => {
    const { io, stdoutLines } = makeIO();
    const fakeFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => tamperedEvidence });
    const result = await main(['verify-package', 'sub-1', '--api-url', 'http://x'], io, { fetchImpl: fakeFetch });
    expect(result.exitCode).toBe(1);
    expect(stdoutLines.join('')).toContain('signature INVALID');
  });

  it('exits 1 with an actionable error when --api-url is omitted', async () => {
    const { io, stderrLines } = makeIO();
    const result = await main(['verify-package', 'sub-1'], io);
    expect(result.exitCode).toBe(1);
    expect(stderrLines.join('')).toMatch(/--api-url/);
  });
});
