#!/usr/bin/env node
// Resolve the Supadata API key locally and print it to stdout for a caller to
// pipe into social-fetch.mjs. This file does not perform any network I/O.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');

function resolveFromConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const raw = config?.mcp?.servers?.supadata?.env?.SUPADATA_API_KEY;
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  } catch {
    return null;
  }
  return null;
}

const key = process.env.SUPADATA_API_KEY || resolveFromConfig();
if (!key) {
  console.error('No SUPADATA_API_KEY found.');
  process.exit(2);
}

process.stdout.write(key);
