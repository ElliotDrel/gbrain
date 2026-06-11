#!/usr/bin/env node
// Resolve the provider keys needed by social-fetch.mjs and print a small JSON
// bundle to stdout. This file does not perform any network I/O.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const envPath = path.join(os.homedir(), '.openclaw', '.env');
const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
const KEY_NAMES = ['SCRAPECREATORS_API_KEY', 'SCRAPE_CREATORS_API_KEY'];

function resolveScrapeCreatorsFromDotEnv() {
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      for (const name of KEY_NAMES) {
        const match = trimmed.match(new RegExp(`^${name}=(.*)$`));
        if (!match) continue;
        const value = match[1].trim().replace(/^['"]|['"]$/g, '');
        if (value) return value;
      }
    }
  } catch {
    return null;
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

const scrapeCreatorsApiKey =
  process.env.SCRAPECREATORS_API_KEY ||
  process.env.SCRAPE_CREATORS_API_KEY ||
  resolveScrapeCreatorsFromDotEnv();
if (!scrapeCreatorsApiKey) {
  console.error('No SCRAPECREATORS_API_KEY / SCRAPE_CREATORS_API_KEY found.');
  process.exit(2);
}

const supadataApiKey =
  process.env.SUPADATA_API_KEY ||
  resolveSupadataFromConfig() ||
  null;

process.stdout.write(JSON.stringify({
  scrapeCreatorsApiKey,
  supadataApiKey,
}));
