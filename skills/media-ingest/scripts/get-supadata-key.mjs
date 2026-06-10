#!/usr/bin/env node
// Resolve the ScrapeCreators API key locally and print it to stdout for a
// caller to pipe into social-fetch.mjs. This file does not perform any network
// I/O.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const envPath = path.join(os.homedir(), '.openclaw', '.env');

function resolveFromDotEnv() {
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^SCRAPECREATORS_API_KEY=(.*)$/);
      if (!match) continue;
      const value = match[1].trim().replace(/^['"]|['"]$/g, '');
      if (value) return value;
    }
  } catch {
    return null;
  }
  return null;
}

const key = process.env.SCRAPECREATORS_API_KEY || resolveFromDotEnv();
if (!key) {
  console.error('No SCRAPECREATORS_API_KEY found.');
  process.exit(2);
}

process.stdout.write(key);
