import { ValidationPipe, ValidationPipeOptions } from '@nestjs/common';

/**
 * Shared ValidationPipe configuration -- imported by the running application (main.ts) and every
 * e2e/integration test that spins up its own Nest application, so the whitelist/
 * forbidNonWhitelisted behavior can never drift between production and test.
 */
export const GLOBAL_VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

export function createGlobalValidationPipe(): ValidationPipe {
  return new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
}
