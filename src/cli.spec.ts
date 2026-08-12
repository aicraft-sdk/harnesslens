import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from './cli.js';

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
