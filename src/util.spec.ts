import { describe, expect, it } from 'vitest';
import { findSecret } from './util.js';

describe('findSecret', () => {
  it('does not flag the real apps-platform false positive (sequential placeholder Stripe key)', () => {
    const content = "const apiKey = 'sk_live_1234567890abcdef'; // NEVER!";
    expect(findSecret(content)).toBeNull();
  });

  it('still flags a genuinely random-looking Stripe secret key', () => {
    const content = "const apiKey = 'sk_live_7Kp2xVm9QaLz4RbNwEuJ8';";
    expect(findSecret(content)).toBe('Stripe secret key');
  });

  it('does not flag a sequential placeholder OpenAI-style key', () => {
    const content = "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz";
    expect(findSecret(content)).toBeNull();
  });

  it('still flags a genuinely random-looking OpenAI-style key', () => {
    const content = "OPENAI_API_KEY=sk-9xQ2mZp7Lk4RvNa1TbY6cWj3He8Vf";
    expect(findSecret(content)).toBe('OpenAI-style API key');
  });

  it('does not flag a sequential placeholder GitHub token', () => {
    const content = "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234";
    expect(findSecret(content)).toBeNull();
  });

  it('still flags a genuinely random-looking GitHub token', () => {
    const content = "GITHUB_TOKEN=ghp_K9pQ2xZmR7vNaT4LbY6cWj3He8VfU1s";
    expect(findSecret(content)).toBe('GitHub token');
  });

  it('does not flag content with an explicit placeholder word', () => {
    const content = 'STRIPE_KEY=sk_live_placeholderkeyvalue1234';
    expect(findSecret(content)).toBeNull();
  });

  it('still flags a private key block despite its repeated-dash header (not misread as filler)', () => {
    const content = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----';
    expect(findSecret(content)).toBe('Private key block');
  });

  it('returns null when no credential-shaped string is present', () => {
    const content = 'This is a normal markdown file with no secrets at all.';
    expect(findSecret(content)).toBeNull();
  });

  it('flags a real Stripe key that appears after an earlier placeholder-shaped match of the same pattern (code-reviewer regression repro)', () => {
    const content = `
❌ WRONG — never do this:
const apiKey = 'sk_live_1234567890abcdef';
...later in the same doc, an accidentally-pasted real example config...
STRIPE_KEY=sk_live_7Kp2xVm9QaLz4RbNwEuJ8
`;
    expect(findSecret(content)).toBe('Stripe secret key');
  });

  it('flags a real OpenAI-style key that appears after an earlier placeholder-shaped match of the same pattern (silent-failure-hunter regression repro)', () => {
    const content =
      'sk-aaaaaaaaaaaaaaaaaaaaaaaa (placeholder) ... real one leaked: sk-9xQ2mZp7Lk4RvNa1TbY6cWj3He8Vf';
    expect(findSecret(content)).toBe('OpenAI-style API key');
  });

  it('flags a real GitHub token that appears before a later placeholder-shaped match of the same pattern', () => {
    const content =
      'GITHUB_TOKEN=ghp_K9pQ2xZmR7vNaT4LbY6cWj3He8VfU1s ... later placeholder: ghp_abcdefghijklmnopqrstuvwxyz1234';
    expect(findSecret(content)).toBe('GitHub token');
  });

  it('flags a real key of a different pattern when a placeholder-shaped match of another pattern also appears', () => {
    const content =
      "STRIPE_KEY=sk_live_1234567890abcdef ... OPENAI_API_KEY=sk-9xQ2mZp7Lk4RvNa1TbY6cWj3He8Vf";
    expect(findSecret(content)).toBe('OpenAI-style API key');
  });

  it('is stateless across repeated calls (no shared RegExp lastIndex leaks between invocations)', () => {
    const placeholderOnly = "const apiKey = 'sk_live_1234567890abcdef';";
    const placeholderThenReal = `${placeholderOnly}\nSTRIPE_KEY=sk_live_7Kp2xVm9QaLz4RbNwEuJ8`;
    // Interleave calls with the same pattern in different orders; if a
    // global RegExp's lastIndex leaked across calls, one of these repeats
    // would return a stale or inconsistent result.
    expect(findSecret(placeholderOnly)).toBeNull();
    expect(findSecret(placeholderThenReal)).toBe('Stripe secret key');
    expect(findSecret(placeholderOnly)).toBeNull();
    expect(findSecret(placeholderThenReal)).toBe('Stripe secret key');
  });
});
