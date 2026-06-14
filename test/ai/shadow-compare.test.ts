import { describe, test, expect } from 'bun:test';
import {
  classifyShadowTier,
  getShadowModels,
  shadowEnabled,
} from '../../src/core/ai/shadow-compare.ts';
import { withEnv } from '../helpers/with-env.ts';

describe('shadow-compare tier classification', () => {
  test('classifies sonnet separately from opus', () => {
    expect(classifyShadowTier('anthropic:claude-sonnet-4-6')).toBe('sonnet');
    expect(classifyShadowTier('anthropic:claude-haiku-4-5-20251001')).toBe('haiku');
    expect(classifyShadowTier('anthropic:claude-opus-4-7')).toBe('opus');
  });

  test('returns null for models outside the anthropic sonnet/haiku/opus lanes', () => {
    expect(classifyShadowTier('openai:gpt-4.1')).toBeNull();
  });
});

describe('shadow-compare env routing', () => {
  test('reads a distinct env var per lane', async () => {
    await withEnv(
      {
        GBRAIN_SHADOW_SONNET: 'openai:gpt-4.1, openai:gpt-5.4',
        GBRAIN_SHADOW_HAIKU: 'openai:gpt-4.1-mini',
        GBRAIN_SHADOW_OPUS: 'openai:gpt-5.4',
      },
      async () => {
        expect(getShadowModels('anthropic:claude-sonnet-4-6')).toEqual([
          'openai:gpt-4.1',
          'openai:gpt-5.4',
        ]);
        expect(getShadowModels('anthropic:claude-haiku-4-5-20251001')).toEqual([
          'openai:gpt-4.1-mini',
        ]);
        expect(getShadowModels('anthropic:claude-opus-4-7')).toEqual([
          'openai:gpt-5.4',
        ]);
      },
    );
  });

  test('shadowEnabled turns on when only opus shadowing is configured', async () => {
    await withEnv(
      {
        GBRAIN_SHADOW_SONNET: undefined,
        GBRAIN_SHADOW_HAIKU: undefined,
        GBRAIN_SHADOW_OPUS: 'openai:gpt-5.4',
      },
      async () => {
        expect(shadowEnabled()).toBe(true);
      },
    );
  });
});
