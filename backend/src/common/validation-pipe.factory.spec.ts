import { describe, it, expect } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS, createGlobalValidationPipe } from './validation-pipe.factory';

describe('createGlobalValidationPipe', () => {
  it('returns a ValidationPipe instance', () => {
    expect(createGlobalValidationPipe()).toBeInstanceOf(ValidationPipe);
  });

  it('exposes shared options with whitelist and forbidNonWhitelisted both true', () => {
    expect(GLOBAL_VALIDATION_PIPE_OPTIONS).toEqual({ whitelist: true, forbidNonWhitelisted: true });
  });
});
