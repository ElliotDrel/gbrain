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
// id-gate does. Works for any space-delimited script (Latin, Cyrillic, accented,
// etc.) — normalize() keeps all Unicode letters/numbers. (Scriptio-continua langs
// like Chinese/Japanese have no word breaks, so word-shingling degrades there.)

import fs from 'node:fs';
import path from 'node:path';

// Lowercase, drop [m:ss] timestamp prefixes, strip punctuation, collapse spaces.
// Unicode-aware: keeps letters/numbers in ANY script (Cyrillic, accented Latin, …),
// not just ASCII — otherwise non-English transcripts normalize to "" and dedup is blind.
export function normalize(text) {
  return String(text || '')
    .replace(/\[[0-9:]+\]/g, ' ')   // [0:00] / [1:23] timestamp markers
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Set of word n-grams. Falls back to the word set when shorter than n words.
export function shingles(text, n = 4) {
  const words = normalize(text).split(' ').filter(Boolean);
  const set = new Set();
  if (words.length < n) { for (const w of words) set.add(w); return set; }
  for (let i = 0; i + n <= words.length; i++) set.add(words.slice(i, i + n).join(' '));
  return set;
}

function intersize(a, b) {
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const x of small) if (big.has(x)) inter++;
  return inter;
}

export function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  const inter = intersize(a, b);
  return inter / (a.size + b.size - inter);
}

// Overlap coefficient (Szymkiewicz–Simpson): |A∩B| / min(|A|,|B|). ~1.0 when the
// smaller transcript is contained in the larger — i.e. a clip-of-a-clip, or a
// trimmed/extended re-upload — which Jaccard misses because the length gap inflates
// the union.
export function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  return intersize(a, b) / Math.min(a.size, b.size);
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
// different video by the same creator.
const NGRAM = 2;
const DEFAULT_THRESHOLD = 0.5;       // Jaccard — near-identical (same clip)
const OVERLAP_THRESHOLD = 0.8;       // overlap coef — one clip contained in the other
const MIN_OVERLAP_SHINGLES = 20;     // ignore tiny fragments (~<15s) that match everything

// Scan sidecars in `dir` for transcripts near-duplicate to `transcript`. Flags two
// relationships: 'near-duplicate' (high Jaccard — same clip) and 'subset' (high
// overlap — one is a clip of / a trimmed-or-extended cut of the other). Returns
// matches [{file, platform, id, url, similarity, overlap, reason, duration}] sorted
// by strength desc, excluding the sidecar whose id === selfId.
export function findContentDuplicates(transcript, dir, { selfId = null, threshold = DEFAULT_THRESHOLD, overlapThreshold = OVERLAP_THRESHOLD } = {}) {
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
    const other = shingles(extractTranscript(content), NGRAM);
    const jac = jaccard(target, other);
    const ov = overlap(target, other);
    const smaller = Math.min(target.size, other.size);
    let reason = null;
    if (jac >= threshold) reason = 'near-duplicate';
    else if (ov >= overlapThreshold && smaller >= MIN_OVERLAP_SHINGLES) reason = 'subset';
    if (!reason) continue;
    const dur = frontVal(content, '_duration');
    out.push({
      file: path.join(dir, f),   // absolute path so the caller/AI can read it directly
      platform: frontVal(content, 'platform') || 'unknown',
      id,
      url: frontVal(content, '_canonical_url') || frontVal(content, '_source_url') || '',
      similarity: Number(jac.toFixed(3)),
      overlap: Number(ov.toFixed(3)),
      reason,
      duration: dur ? Number(dur) : null,
    });
  }
  return out.sort((a, b) => Math.max(b.similarity, b.overlap) - Math.max(a.similarity, a.overlap));
}
