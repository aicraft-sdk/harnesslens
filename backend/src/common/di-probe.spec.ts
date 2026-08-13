import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, it, expect } from 'vitest';

@Injectable()
class DiProbeDependency {
  readonly value = 'dependency-resolved';
}

@Injectable()
class DiProbeConsumer {
  constructor(public readonly dependency: DiProbeDependency) {}
}

describe('Vitest transform emits constructor-injection metadata for Nest DI', () => {
  it('resolves a constructor-injected provider via Test.createTestingModule().compile()', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [DiProbeDependency, DiProbeConsumer],
    }).compile();
    const consumer = moduleRef.get(DiProbeConsumer);
    expect(consumer.dependency).toBeInstanceOf(DiProbeDependency);
    expect(consumer.dependency.value).toBe('dependency-resolved');
  });
});
