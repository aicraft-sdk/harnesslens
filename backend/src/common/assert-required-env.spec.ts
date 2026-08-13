import { afterEach, describe, expect, it } from 'vitest';
import { assertRequiredEnv } from './assert-required-env';

const TEST_VAR = 'ASSERT_REQUIRED_ENV_TEST_VAR';

describe('assertRequiredEnv', () => {
  afterEach(() => {
    delete process.env[TEST_VAR];
  });

  it('throws a descriptive error when a required env var is unset', () => {
    delete process.env[TEST_VAR];
    expect(() => assertRequiredEnv([TEST_VAR])).toThrow(
      `Missing required environment variable(s): ${TEST_VAR}`,
    );
  });

  it('does not throw when all required env vars are set', () => {
    process.env[TEST_VAR] = 'some-value';
    expect(() => assertRequiredEnv([TEST_VAR])).not.toThrow();
  });
});
