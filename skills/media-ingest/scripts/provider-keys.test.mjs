import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAllowedCommandSync } from '../../../lib/allowed-child-process.mjs';

const scriptPath = fileURLToPath(new URL('./provider-keys.mjs', import.meta.url));

function runProviderKeys({ dotEnv = '', openclawJson = null, env = {} } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-keys-'));
  const openclawDir = path.join(home, '.openclaw');
  fs.mkdirSync(openclawDir, { recursive: true });
  if (dotEnv !== null) {
    fs.writeFileSync(path.join(openclawDir, '.env'), dotEnv);
  }
  if (openclawJson !== null) {
    fs.writeFileSync(
      path.join(openclawDir, 'openclaw.json'),
      JSON.stringify(openclawJson),
    );
  }
  const result = runAllowedCommandSync(process.execPath, [scriptPath], {
    allowNodeEntrypoint: scriptPath,
    env: {
      ...process.env,
      HOME: home,
      SCRAPECREATORS_API_KEY: '',
      SCRAPE_CREATORS_API_KEY: '',
      ...env,
    },
    encoding: 'utf8',
  });
  fs.rmSync(home, { recursive: true, force: true });
  return result;
}

test('.env value is authoritative when it conflicts with env', () => {
  const result = runProviderKeys({
    dotEnv: 'SCRAPECREATORS_API_KEY=file-key\n',
    env: { SCRAPECREATORS_API_KEY: 'env-key' },
  });

  assert.equal(result.status, 0);
  assert.match(result.stderr, /Using the \.env value/);
  assert.equal(JSON.parse(result.stdout).scrapeCreatorsApiKey, 'file-key');
});

test('env fallback works when .env is silent', () => {
  const result = runProviderKeys({
    dotEnv: '# no scrapecreators key here\n',
    env: { SCRAPECREATORS_API_KEY: 'env-key' },
  });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(JSON.parse(result.stdout).scrapeCreatorsApiKey, 'env-key');
});

test('unquoted inline comments are stripped from .env values', () => {
  const result = runProviderKeys({
    dotEnv: 'SCRAPECREATORS_API_KEY=file-key # rotated 2026-06-19\n',
  });

  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).scrapeCreatorsApiKey, 'file-key');
});

test('export prefix and whitespace around equals are accepted', () => {
  const result = runProviderKeys({
    dotEnv: 'export SCRAPECREATORS_API_KEY = spaced-key\n',
  });

  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).scrapeCreatorsApiKey, 'spaced-key');
});

test('quoted values keep embedded hashes and ignore trailing comments', () => {
  const result = runProviderKeys({
    dotEnv: 'SCRAPECREATORS_API_KEY="abc#123" # keep hash\n',
  });

  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).scrapeCreatorsApiKey, 'abc#123');
});

test('missing key exits with code 2', () => {
  const result = runProviderKeys({
    dotEnv: '# empty\n',
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /No SCRAPECREATORS_API_KEY/);
});
