#!/usr/bin/env node
// Regression tests for provider-keys.mjs precedence + .env parsing.
// Self-contained: every case uses a synthetic $HOME, no live keys required.
// Run: node provider-keys.test.mjs   (exit 0 = all pass)
//
// Guards the 2026-06-19 SCRAPE_CREATORS_API_KEY incident fixes:
//   - file (~/.openclaw/.env) is authoritative; env is fallback only
//   - WARN on file/env disagreement (no secret in the message)
//   - .env parsing strips inline comments / honors quotes / `export` / spaces

import cp from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.join(path.dirname(new URL(import.meta.url).pathname), 'provider-keys.mjs');
let pass = 0, fail = 0;
const ok = (c, msg) => { (c ? pass++ : fail++); console.log(`  [${c ? 'PASS' : 'FAIL'}] ${msg}`); };

function run({ envFile = null, env = {} } = {}) {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-'));
  fs.mkdirSync(path.join(h, '.openclaw'), { recursive: true });
  if (envFile !== null) fs.writeFileSync(path.join(h, '.openclaw', '.env'), envFile);
  const base = { ...process.env };
  delete base.SCRAPECREATORS_API_KEY;
  delete base.SCRAPE_CREATORS_API_KEY;
  const r = cp.spawnSync(process.execPath, [SCRIPT], {
    env: { ...base, HOME: h, ...env }, encoding: 'utf8',
  });
  return { out: r.stdout ? JSON.parse(r.stdout) : null, err: (r.stderr || '').trim(), code: r.status };
}

let r;
console.log('=== file-only -> file value, no warn ===');
r = run({ envFile: 'SCRAPECREATORS_API_KEY=filekey\n' });
ok(r.out?.scrapeCreatorsApiKey === 'filekey' && !/WARN/.test(r.err), 'file used, no warn');

console.log('=== conflict -> file wins + WARN, no secret leaked ===');
r = run({ envFile: 'SCRAPECREATORS_API_KEY=filekey\n', env: { SCRAPE_CREATORS_API_KEY: 'staleorphan' } });
ok(r.out?.scrapeCreatorsApiKey === 'filekey', 'file beats orphan env');
ok(/WARN/.test(r.err) && !/filekey|staleorphan/.test(r.err), 'WARN fired without leaking either key');

console.log('=== same value -> no false-positive warn ===');
r = run({ envFile: 'SCRAPECREATORS_API_KEY=samekey\n', env: { SCRAPECREATORS_API_KEY: 'samekey' } });
ok(!/WARN/.test(r.err), 'no warn when equal');

console.log('=== env fallback when file silent ===');
r = run({ envFile: '', env: { SCRAPECREATORS_API_KEY: 'envkey' } });
ok(r.out?.scrapeCreatorsApiKey === 'envkey' && !/WARN/.test(r.err), 'env used as fallback');

console.log('=== nothing -> exit 2 ===');
r = run({ envFile: '' });
ok(r.code === 2, `exit 2 (got ${r.code})`);

console.log('=== inline comment stripped (unquoted) ===');
r = run({ envFile: 'SCRAPECREATORS_API_KEY=realkey123 # rotated 2026-06-19\n' });
ok(r.out?.scrapeCreatorsApiKey === 'realkey123', `got "${r.out?.scrapeCreatorsApiKey}"`);

console.log('=== # preserved inside quotes ===');
r = run({ envFile: 'SCRAPECREATORS_API_KEY="ab#cd123"\n' });
ok(r.out?.scrapeCreatorsApiKey === 'ab#cd123', `got "${r.out?.scrapeCreatorsApiKey}"`);

console.log('=== export prefix + spaces around = ===');
r = run({ envFile: 'export SCRAPECREATORS_API_KEY = spacedkey \n' });
ok(r.out?.scrapeCreatorsApiKey === 'spacedkey', `got "${r.out?.scrapeCreatorsApiKey}"`);

console.log('=== underscore legacy name still readable from file ===');
r = run({ envFile: 'SCRAPE_CREATORS_API_KEY=legacyname\n' });
ok(r.out?.scrapeCreatorsApiKey === 'legacyname', `got "${r.out?.scrapeCreatorsApiKey}"`);

console.log(`\n${fail === 0 ? 'ALL GREEN' : 'FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
