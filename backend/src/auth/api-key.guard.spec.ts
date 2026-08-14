import { describe, it, expect, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { ApiKeyGuard } from './api-key.guard';
import type { Account } from '../accounts/entities/account.entity';

function buildContext(authHeader: string | undefined) {
  const request: { headers: Record<string, string>; account?: Account } = {
    headers: authHeader ? { authorization: authHeader } : {},
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('ApiKeyGuard', () => {
  it('rejects a request with no Authorization header', async () => {
    const findOneBy = vi.fn();
    const accountsRepo = { findOneBy } as unknown as Repository<Account>;
    const guard = new ApiKeyGuard(accountsRepo);
    const { context } = buildContext(undefined);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findOneBy).not.toHaveBeenCalled();
  });

  it('rejects a request whose bearer token does not match any stored hash', async () => {
    const findOneBy = vi.fn().mockResolvedValue(null);
    const accountsRepo = { findOneBy } as unknown as Repository<Account>;
    const guard = new ApiKeyGuard(accountsRepo);
    const { context } = buildContext('Bearer not-a-real-key');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findOneBy).toHaveBeenCalledWith({ apiKeyHash: expect.any(String) });
  });

  it('attaches the resolved account to the request when the key matches', async () => {
    const account = { id: 'acc-1', orgName: 'acme' } as Account;
    const findOneBy = vi.fn().mockResolvedValue(account);
    const accountsRepo = { findOneBy } as unknown as Repository<Account>;
    const guard = new ApiKeyGuard(accountsRepo);
    const { context, request } = buildContext('Bearer real-key');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.account).toBe(account);
  });
});
