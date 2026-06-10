#!/usr/bin/env node
// Local-only helpers for social-fetch.mjs. Kept separate from provider network
// calls so audits can distinguish disk provenance logic from outbound traffic.

import fs from 'node:fs';
import path from 'node:path';

export function existingOkFile(socialDir, id) {
  if (!id) return null;
  const want = String(id).replace(/[^A-Za-z0-9._-]/g, '_');
  try {
    for (const fileName of fs.readdirSync(socialDir)) {
      if (!fileName.endsWith(`-${want}.txt`)) continue;
      const candidate = path.join(socialDir, fileName);
      const head = fs.readFileSync(candidate, 'utf8').slice(0, 4000);
      return /^_transcript_state:\s*"ok"/m.test(head) ? candidate : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function findCitingPages(brainDir, needles) {
  const hits = new Set();
  const skip = new Set(['sources', 'node_modules']);
  (function walk(dir) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) walk(fullPath);
        continue;
      }
      if (!entry.name.endsWith('.md')) continue;
      let content = '';
      try {
        content = fs.readFileSync(fullPath, 'utf8');
      } catch {
        continue;
      }
      if (needles.some((needle) => content.includes(needle))) hits.add(fullPath);
    }
  })(brainDir);
  return [...hits];
}
