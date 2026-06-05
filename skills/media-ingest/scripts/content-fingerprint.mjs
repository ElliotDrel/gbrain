// content-fingerprint.mjs — near-duplicate detection for cross-platform reposts.
//
// The same video posted to Instagram, TikTok and YouTube Shorts has a DIFFERENT
// url + id on each platform, so the per-platform id-gate in social-fetch.mjs can't
// see that they're the same clip. What IS the same is the spoken transcript. We
// fingerprint it and compare via word n-gram (shingle) Jaccard similarity:
//   - identical clip cross-posted -> ~1.0 (even if captions differ slightly)
//   - a different video on the same topic by the same creator -> low (< ~0.3)
//
// Deterministic: same transcripts -> same score. Pure local compute, no network.
// IMPORTANT: this needs the transcript, so it runs AFTER the (paid) fetch. It
// prevents a duplicate brain PAGE; it cannot save the Supadata credit the way the
// id-gate does. Tuned for English transcripts (normalize() keeps [a-z0-9]).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Lowercase, drop [m:ss] timestamp prefixes, strip punctuation, collapse spaces.
export function normalize(text) {
  return String(text || '')
    .replace(/\[[0-9:]+\]/g, ' ')   // [0:00] / [1:23] timestamp markers
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sha256(text) {
  return crypto.createHash('sha256').update(normalize(text)).digest('hex');
}

// Set of word n-grams. Falls back to the word set when shorter than n words.
export function shingles(text, n = 4) {
  const words = normalize(text).split(' ').filter(Boolean);
  const set = new Set();
  if (words.length < n) { for (const w of words) set.add(w); return set; }
  for (let i = 0; i + n <= words.length; i++) set.add(words.slice(i, i + n).join(' '));
  return set;
}

export function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const x of small) if (big.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// Pull the transcript body from a sidecar .txt: everything after the "## Transcript"
// heading, else the whole post-frontmatter body.
export function extractTranscript(content) {
  const body = String(content).replace(/^---\n[\s\S]*?\n---\n/, '');
  const m = body.match(/##\s+Transcript[^\n]*\n([\s\S]*)$/);
  return (m ? m[1] : body).trim();
}

const frontVal = (content, key) => {
  const m = content.match(new RegExp(`^${key}:\\s*"?([^"\\n]+)"?`, 'm'));
  const v = m ? m[1].trim() : null;
  return v && v !== 'null' ? v : null;
};

// Bigrams (n=2) are the operating point: tolerant of the word-by-word differences
// between platforms' auto-captions of the SAME clip, while still separating a
// different video by the same creator. Exact (sha-identical) transcripts score 1.0.
const NGRAM = 2;
const DEFAULT_THRESHOLD = 0.5;

// Scan sidecars in `dir` for transcripts near-duplicate to `transcript`. Returns
// matches [{file, platform, id, url, similarity}] >= threshold, sorted desc,
// excluding the sidecar whose id === selfId.
export function findContentDuplicates(transcript, dir, { selfId = null, threshold = DEFAULT_THRESHOLD } = {}) {
  const target = shingles(transcript, NGRAM);
  if (!target.size) return [];
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.txt')) continue;
    const content = fs.readFileSync(path.join(dir, f), 'utf8');
    const id = frontVal(content, 'id');
    if (selfId && id === selfId) continue;
    const sim = jaccard(target, shingles(extractTranscript(content), NGRAM));
    if (sim >= threshold) {
      out.push({
        file: f,
        platform: frontVal(content, 'platform') || 'unknown',
        id,
        url: frontVal(content, '_canonical_url') || frontVal(content, '_source_url') || '',
        similarity: Number(sim.toFixed(3)),
      });
    }
  }
  return out.sort((a, b) => b.similarity - a.similarity);
}
