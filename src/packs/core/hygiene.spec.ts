import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createScanContext } from '../../scan.js';
import { hygieneChecks } from './hygiene.js';

function checkById(id: string) {
  const check = hygieneChecks.find((c) => c.id === id);
  if (!check) throw new Error(`fixture assumption broken: check ${id} not found`);
  return check;
}

describe('core hygiene checks', () => {
  describe('HYG-09 — MCP servers reference pinned sources', () => {
    let dir: string;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harnesslens-hyg09-'));
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('passes when no MCP config exists at all (nothing to leak)', () => {
      fs.writeFileSync(path.join(dir, 'README.md'), '# nothing here\n');
      const ctx = createScanContext(dir);
      const outcome = checkById('HYG-09').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toMatch(/No MCP config/);
    });

    it('fails when an MCP server uses a floating @latest tag', () => {
      fs.mkdirSync(path.join(dir, '.cursor'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.cursor', 'mcp.json'),
        JSON.stringify({
          mcpServers: {
            'example-api': { command: 'npx', args: ['-y', '@example/mcp-server@latest'] },
          },
        }),
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('HYG-09').run(ctx);
      expect(outcome.passed).toBe(false);
      expect(outcome.evidence).toMatch(/@latest/);
    });

    it('fails when an MCP server references a bare, unversioned package', () => {
      fs.mkdirSync(path.join(dir, '.cursor'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.cursor', 'mcp.json'),
        JSON.stringify({
          mcpServers: {
            'example-api': { command: 'npx', args: ['-y', '@example/mcp-server'] },
          },
        }),
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('HYG-09').run(ctx);
      expect(outcome.passed).toBe(false);
      expect(outcome.evidence).toMatch(/no version specifier/);
    });

    it('fails when a remote MCP server URL has no version/commit/tag segment', () => {
      fs.writeFileSync(
        path.join(dir, '.mcp.json'),
        JSON.stringify({ mcpServers: { remote: { url: 'https://mcp.example.com/sse' } } }),
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('HYG-09').run(ctx);
      expect(outcome.passed).toBe(false);
      expect(outcome.evidence).toMatch(/no version\/commit\/tag segment/);
    });

    it('fails when the unpinned package specifier is not the last arg (canonical filesystem-server shape)', () => {
      fs.writeFileSync(
        path.join(dir, '.mcp.json'),
        JSON.stringify({
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/foo/Desktop'],
        }),
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('HYG-09').run(ctx);
      expect(outcome.passed).toBe(false);
      expect(outcome.evidence).toMatch(/@modelcontextprotocol\/server-filesystem/);
      expect(outcome.evidence).toMatch(/no version specifier/);
    });

    it('passes for a pinned MCP server with a trailing non-path bareword arg (e.g. schema name)', () => {
      fs.writeFileSync(
        path.join(dir, '.mcp.json'),
        JSON.stringify({
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-postgres@1.0.0', 'public'],
        }),
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('HYG-09').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toMatch(/all MCP server references look pinned/);
    });

    it('returns a normal CheckOutcome (not a thrown error) for a deeply-nested MCP config within the size cap', () => {
      // Build a deeply-nested-but-small JSON object (well past any reasonable
      // recursion depth cap, but tiny in byte size) to prove collectServerEntries
      // doesn't blow the call stack on pathological-but-valid input.
      let nested: unknown = { command: 'npx', args: ['-y', '@example/mcp-server@1.0.0'] };
      for (let i = 0; i < 5000; i++) {
        nested = { wrapper: nested };
      }
      fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { deep: nested } }));
      const ctx = createScanContext(dir);
      expect(() => checkById('HYG-09').run(ctx)).not.toThrow();
      const outcome = checkById('HYG-09').run(ctx);
      expect(typeof outcome.passed).toBe('boolean');
      expect(typeof outcome.evidence).toBe('string');
    });

    it('fails without throwing when the MCP config is malformed JSON', () => {
      fs.writeFileSync(path.join(dir, '.mcp.json'), '{ "mcpServers": ');
      const ctx = createScanContext(dir);
      const outcome = checkById('HYG-09').run(ctx);
      expect(outcome.passed).toBe(false);
      expect(outcome.evidence).toMatch(/not valid JSON/);
    });

    it('passes when every MCP server reference is pinned', () => {
      fs.mkdirSync(path.join(dir, '.cursor'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.cursor', 'mcp.json'),
        JSON.stringify({
          mcpServers: {
            'example-api': { command: 'npx', args: ['-y', '@example/mcp-server@1.4.2'] },
            remote: { url: 'https://mcp.example.com/releases/v2.1.0/sse' },
          },
        }),
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('HYG-09').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toMatch(/all MCP server references look pinned/);
    });

    it('passes for a pinned package run via a subcommand-gated runner (pnpm dlx)', () => {
      fs.writeFileSync(
        path.join(dir, '.mcp.json'),
        JSON.stringify({
          command: 'pnpm',
          args: ['dlx', '@modelcontextprotocol/server-postgres@1.0.0', 'public'],
        }),
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('HYG-09').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toMatch(/all MCP server references look pinned/);
    });

    it('passes for a pinned package run via a subcommand-gated runner (npm exec)', () => {
      fs.writeFileSync(
        path.join(dir, '.mcp.json'),
        JSON.stringify({
          command: 'npm',
          args: ['exec', '-y', '@modelcontextprotocol/server-postgres@1.0.0'],
        }),
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('HYG-09').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toMatch(/all MCP server references look pinned/);
    });

    it('fails for an unpinned package run via a subcommand-gated runner, naming the package not the subcommand', () => {
      fs.writeFileSync(
        path.join(dir, '.mcp.json'),
        JSON.stringify({
          command: 'pnpm',
          args: ['dlx', '@modelcontextprotocol/server-postgres', 'public'],
        }),
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('HYG-09').run(ctx);
      expect(outcome.passed).toBe(false);
      expect(outcome.evidence).toMatch(/@modelcontextprotocol\/server-postgres/);
      expect(outcome.evidence).not.toMatch(/"dlx"/);
    });

    it('fails for an unpinned package past a value-consuming flag, naming the package not the flag value', () => {
      fs.writeFileSync(
        path.join(dir, '.mcp.json'),
        JSON.stringify({
          command: 'npx',
          args: ['--prefix', '/tmp/foo', '@pkg/name'],
        }),
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('HYG-09').run(ctx);
      expect(outcome.passed).toBe(false);
      expect(outcome.evidence).toMatch(/@pkg\/name/);
      expect(outcome.evidence).not.toMatch(/\/tmp\/foo/);
    });

    it('passes when the main package is pinned via a package-value flag (uvx --from)', () => {
      fs.writeFileSync(
        path.join(dir, '.mcp.json'),
        JSON.stringify({
          command: 'uvx',
          args: ['--with', 'beautifulsoup4', '--from', 'mcp-server-fetch==1.2.3', 'mcp-server-fetch'],
        }),
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('HYG-09').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toMatch(/all MCP server references look pinned/);
    });

    it('passes for an npm invocation whose subcommand is not a one-shot package runner (npm run)', () => {
      fs.writeFileSync(
        path.join(dir, '.mcp.json'),
        JSON.stringify({
          command: 'npm',
          args: ['run', 'build'],
        }),
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('HYG-09').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toMatch(/all MCP server references look pinned/);
    });

    it('does not flag bare "uv run" as unpinned (intentionally excluded from package-arg detection)', () => {
      fs.writeFileSync(
        path.join(dir, '.mcp.json'),
        JSON.stringify({
          command: 'uv',
          args: ['run', '--with', 'mcp-server-time@1.0.0', 'mcp-server-time'],
        }),
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('HYG-09').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toMatch(/all MCP server references look pinned/);
    });

    it('passes for a pinned package run via pipx (subcommand-gated, "pipx run <pkg>==<ver>")', () => {
      fs.writeFileSync(
        path.join(dir, '.mcp.json'),
        JSON.stringify({
          command: 'pipx',
          args: ['run', 'mcp-server-fetch==1.2.3'],
        }),
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('HYG-09').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toMatch(/all MCP server references look pinned/);
    });

    it('fails for an unpinned pipx run invocation, naming the real package not the "run" subcommand', () => {
      fs.writeFileSync(
        path.join(dir, '.mcp.json'),
        JSON.stringify({
          command: 'pipx',
          args: ['run', 'mcp-server-fetch'],
        }),
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('HYG-09').run(ctx);
      expect(outcome.passed).toBe(false);
      expect(outcome.evidence).toMatch(/mcp-server-fetch/);
      expect(outcome.evidence).not.toMatch(/"run"/);
    });

    it('passes for a pinned pipx run invocation using "@"-style pin', () => {
      fs.writeFileSync(
        path.join(dir, '.mcp.json'),
        JSON.stringify({
          command: 'pipx',
          args: ['run', 'mcp-server-fetch@1.2.3'],
        }),
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('HYG-09').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toMatch(/all MCP server references look pinned/);
    });

    it('passes for a pinned bunx package run via the -p/--package flag', () => {
      fs.writeFileSync(
        path.join(dir, '.mcp.json'),
        JSON.stringify({
          command: 'bunx',
          args: ['-p', '@angular/cli@17.0.0', 'ng'],
        }),
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('HYG-09').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toMatch(/all MCP server references look pinned/);
    });

    it('fails for an unpinned bunx package past a boolean flag + package flag, naming the package not the flag', () => {
      fs.writeFileSync(
        path.join(dir, '.mcp.json'),
        JSON.stringify({
          command: 'bunx',
          args: ['--silent', '-p', '@angular/cli', 'ng'],
        }),
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('HYG-09').run(ctx);
      expect(outcome.passed).toBe(false);
      expect(outcome.evidence).toMatch(/@angular\/cli/);
    });

    it('fails for an unpinned bunx bare positional past a boolean flag, naming the package not the flag', () => {
      fs.writeFileSync(
        path.join(dir, '.mcp.json'),
        JSON.stringify({
          command: 'bunx',
          args: ['--verbose', '@angular/cli'],
        }),
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('HYG-09').run(ctx);
      expect(outcome.passed).toBe(false);
      expect(outcome.evidence).toMatch(/@angular\/cli/);
      expect(outcome.evidence).not.toMatch(/--verbose/);
    });

    it('passes for a pipx run invocation with a value-taking flag (--python) before the pinned package', () => {
      fs.writeFileSync(
        path.join(dir, '.mcp.json'),
        JSON.stringify({
          command: 'pipx',
          args: ['run', '--python', '3.11', 'mcp-server-fetch==1.2.3'],
        }),
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('HYG-09').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toMatch(/all MCP server references look pinned/);
    });

    it('passes for a pipx run invocation pinned via --spec (package-value flag, distinct app entry-point name)', () => {
      fs.writeFileSync(
        path.join(dir, '.mcp.json'),
        JSON.stringify({
          command: 'pipx',
          args: ['run', '--spec', 'internal-tool==2.0.0', 'run-me'],
        }),
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('HYG-09').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toMatch(/all MCP server references look pinned/);
    });

    it('fails for a pipx run invocation with an unpinned --spec value, naming the spec value not the app positional', () => {
      fs.writeFileSync(
        path.join(dir, '.mcp.json'),
        JSON.stringify({
          command: 'pipx',
          args: ['run', '--spec', 'internal-tool', 'run-me'],
        }),
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('HYG-09').run(ctx);
      expect(outcome.passed).toBe(false);
      expect(outcome.evidence).toMatch(/internal-tool/);
      expect(outcome.evidence).not.toMatch(/run-me/);
    });
  });
});
