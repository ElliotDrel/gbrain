import { describe, test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { hydrateProcessEnvFromKeysFile, keysEnvPath } from '../src/core/config.ts';
import { withEnv } from './helpers/with-env.ts';

describe('keys.env hydration', () => {
  test('hydrates missing vars from ~/.gbrain/keys.env', async () => {
    const home = mkdtempSync(join(tmpdir(), 'gbrain-keys-env-'));
    try {
      const dir = join(home, '.gbrain');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'keys.env'),
        [
          'export OPENAI_API_KEY="sk-file-openai"',
          'export ANTHROPIC_API_KEY="sk-file-anthropic"',
          'export GBRAIN_SHADOW_OPUS="openai:gpt-5.4"',
          '',
        ].join('\n'),
      );

      await withEnv(
        {
          GBRAIN_HOME: home,
          OPENAI_API_KEY: undefined,
          ANTHROPIC_API_KEY: undefined,
          GBRAIN_SHADOW_OPUS: undefined,
        },
        async () => {
          hydrateProcessEnvFromKeysFile();
          expect(keysEnvPath()).toBe(join(home, '.gbrain', 'keys.env'));
          expect(process.env.OPENAI_API_KEY).toBe('sk-file-openai');
          expect(process.env.ANTHROPIC_API_KEY).toBe('sk-file-anthropic');
          expect(process.env.GBRAIN_SHADOW_OPUS).toBe('openai:gpt-5.4');
        },
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('real env overrides keys.env values', async () => {
    const home = mkdtempSync(join(tmpdir(), 'gbrain-keys-env-'));
    try {
      const dir = join(home, '.gbrain');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'keys.env'),
        [
          'export OPENAI_API_KEY="sk-file-openai"',
          'export GBRAIN_SHADOW_SONNET="openai:gpt-4.1"',
          '',
        ].join('\n'),
      );

      await withEnv(
        {
          GBRAIN_HOME: home,
          OPENAI_API_KEY: 'sk-real-openai',
          GBRAIN_SHADOW_SONNET: 'openai:gpt-5.4',
        },
        async () => {
          hydrateProcessEnvFromKeysFile();
          expect(process.env.OPENAI_API_KEY).toBe('sk-real-openai');
          expect(process.env.GBRAIN_SHADOW_SONNET).toBe('openai:gpt-5.4');
        },
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
