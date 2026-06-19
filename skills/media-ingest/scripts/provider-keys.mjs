#!/usr/bin/env node
// Resolve the provider keys needed by social-fetch.mjs and print a small JSON
// bundle to stdout. This file does not perform any network I/O.
//
// PRECEDENCE: the persistent secret store is authoritative, NOT the process
// environment. ~/.openclaw/.env wins for ScrapeCreators; ~/.openclaw/openclaw.json
// wins for Supadata; an env var is only a fallback when the store is silent.
// This defuses the "stale exported orphan shadows the corrected file" bug class
// (see the 2026-06-19 SCRAPE_CREATORS_API_KEY incident): editing the file is the
// single source of truth, and a leftover env var can never override it. When the
// store and the env disagree we warn on stderr so drift is loud, not silent.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const envPath = path.join(os.homedir(), '.openclaw', '.env');
const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
const KEY_NAMES = ['SCRAPECREATORS_API_KEY', 'SCRAPE_CREATORS_API_KEY'];

function parseDotEnvValue(rawValue) {
  // Now that the file is authoritative we must parse it carefully — a malformed
  // file value would otherwise silently override a correct env fallback.
  let value = rawValue.trim();
  const quoted = value.match(/^(['"])(.*)\1(?:\s+#.*)?$/);
  if (quoted) {
    // Quoted: take the contents verbatim (a '#' inside quotes is part of the key).
    return quoted[2];
  }
  // Unquoted: strip a trailing inline comment ( whitespace then '#...' ).
  value = value.replace(/\s+#.*$/, '').trim();
  return value;
}

function resolveScrapeCreatorsFromDotEnv() {
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      let trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      trimmed = trimmed.replace(/^export\s+/, ''); // tolerate `export KEY=...`
      for (const name of KEY_NAMES) {
        const match = trimmed.match(new RegExp(`^${name}\\s*=\\s*(.*)$`)); // tolerate spaces around '='
        if (!match) continue;
        const value = parseDotEnvValue(match[1]);
        if (value) return value;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function resolveScrapeCreatorsFromEnv() {
  for (const name of KEY_NAMES) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return null;
}

function resolveSupadataFromConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const raw = config?.mcp?.servers?.supadata?.env?.SUPADATA_API_KEY;
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  } catch {
    return null;
  }
  return null;
}

// --- ScrapeCreators: ~/.openclaw/.env is authoritative, env is fallback ---
const scFile = resolveScrapeCreatorsFromDotEnv();
const scEnv = resolveScrapeCreatorsFromEnv();
if (scFile && scEnv && scFile !== scEnv) {
  console.error(
    'WARN: ScrapeCreators key in ~/.openclaw/.env differs from the ' +
    'SCRAPE(_)CREATORS_API_KEY environment variable. Using the .env value ' +
    '(file is authoritative). A stale/exported env var may be shadowing it.',
  );
}
const scrapeCreatorsApiKey = scFile || scEnv;
if (!scrapeCreatorsApiKey) {
  console.error('No SCRAPECREATORS_API_KEY / SCRAPE_CREATORS_API_KEY found.');
  process.exit(2);
}

// --- Supadata: ~/.openclaw/openclaw.json is authoritative, env is fallback ---
const sdConfig = resolveSupadataFromConfig();
const sdEnv = process.env.SUPADATA_API_KEY && process.env.SUPADATA_API_KEY.trim()
  ? process.env.SUPADATA_API_KEY.trim()
  : null;
if (sdConfig && sdEnv && sdConfig !== sdEnv) {
  console.error(
    'WARN: Supadata key in ~/.openclaw/openclaw.json differs from the ' +
    'SUPADATA_API_KEY environment variable. Using the openclaw.json value ' +
    '(config is authoritative). A stale/exported env var may be shadowing it.',
  );
}
const supadataApiKey = sdConfig || sdEnv || null;

process.stdout.write(JSON.stringify({
  scrapeCreatorsApiKey,
  supadataApiKey,
}));
