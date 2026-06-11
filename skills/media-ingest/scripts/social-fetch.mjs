#!/usr/bin/env node
// social-fetch.mjs — fetch a social/video URL's transcript + metadata and write
// ONE raw file: <brain>/sources/social/<platform>-<id>.txt
//
// NOTE: the file is .txt ON PURPOSE. gbrain sync only ingests .md pages into
// the engine, so a .txt keeps the raw as disk-only provenance (same mechanism
// meetings use for their .raw transcripts) — it never pollutes search.
//
// Keep it simple. Two API calls (metadata + transcript), one file out.
//
// ONE INVOCATION ONLY. ScrapeCreators credits are billed per request, so the
// caller should NOT blindly re-run this script. Transcript requests DO perform
// the built-in 5s / 30s / 60s backoff within the same invocation; anything
// still failing after that is surfaced to Elliot with the exact HTTP status +
// body. The caller (the media-ingest skill / the AI) MUST relay that instead
// of silently re-running and wasting credits.
//
// DEDUP: this post may already be on disk. Each fetch is keyed by the post's
// canonical shortcode/id (the .txt filename suffix), so we refuse to re-fetch a
// post we already have a COMPLETE transcript for — two gates:
//   (1) free URL pre-check BEFORE any API call (no credits, dodges rate limits)
//   (2) authoritative backstop AFTER metadata, BEFORE the costly transcript call
// An incomplete prior fetch (_transcript_state empty/error) is NOT a duplicate —
// it re-fetches to finish. Pass --force to re-fetch deliberately (bills credits).
//
// Usage:  node social-fetch.mjs <url> [--brain <dir>] [--force] [--api-key-stdin]
// Output: prints the written (or already-existing) file path as the last stdout line.
// Exit:   0 ok / already-ingested · 1 usage · 2 no api key · 3 metadata error · 4 transcript error

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolve as resolveUrl } from './canonical-url.mjs';
import { findContentDuplicates } from './content-fingerprint.mjs';
import { getMetadata, getTranscript } from './provider-client.mjs';

const SURFACE = '>>> SURFACE THIS TO THE USER. Built-in transcript retries (5s, 30s, 60s) were already exhausted in this invocation. Do NOT auto-retry again without Elliot deciding to spend another request.';

// ---- args ----
const argv = process.argv.slice(2);
const url = argv.find((a) => !a.startsWith('-'));
const force = argv.includes('--force');
const apiKeyFromStdin = argv.includes('--api-key-stdin');
const brain = path.resolve((() => { const i = argv.indexOf('--brain'); return i >= 0 ? argv[i + 1] : path.join(os.homedir(), 'brain'); })()); // absolute, so every printed path is absolute
if (!url) { console.error('Usage: node social-fetch.mjs <url> [--brain <dir>] [--force] [--api-key-stdin]'); process.exit(1); }

// ---- dedup (deterministic, keyed by the post's canonical shortcode/id) ----
const socialDir = path.join(brain, 'sources', 'social');
const sanitizeId = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_');
function existingOkFile(dir, id) {
  if (!id) return null;
  const want = String(id).replace(/[^A-Za-z0-9._-]/g, '_');
  try {
    for (const fileName of fs.readdirSync(dir)) {
      if (!fileName.endsWith(`-${want}.txt`)) continue;
      const candidate = path.join(dir, fileName);
      const head = fs.readFileSync(candidate, 'utf8').slice(0, 4000);
      return /^_transcript_state:\s*"ok"/m.test(head) ? candidate : null;
    }
  } catch {
    return null;
  }
  return null;
}
function findCitingPages(brainDir, needles) {
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
async function readStdinText() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))).toString('utf8').trim();
}
function parseApiKeys(raw) {
  if (!raw) return { scrapeCreatorsApiKey: null, supadataApiKey: null };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        scrapeCreatorsApiKey: typeof parsed.scrapeCreatorsApiKey === 'string' ? parsed.scrapeCreatorsApiKey.trim() : null,
        supadataApiKey: typeof parsed.supadataApiKey === 'string' ? parsed.supadataApiKey.trim() : null,
      };
    }
  } catch {}
  return { scrapeCreatorsApiKey: raw.trim() || null, supadataApiKey: null };
}
function skipIfDuplicate(id, stage) {
  if (force) return;
  const hit = existingOkFile(socialDir, id);
  if (!hit) return;
  console.log(hit); // path, for the caller — same stdout contract as a fresh write
  console.error(`[social-fetch] ALREADY INGESTED (${stage}) — ${hit}`);
  console.error('[social-fetch] Skipped: this post already has a complete transcript on disk. Re-run with --force to re-fetch (bills credits). Surface to Elliot — do NOT silently re-file a duplicate concept page.');
  process.exit(0);
}
// GATE 1 — canonicalize the URL (handles share/short links via a FREE redirect
// follow — NOT an API credit) to get the post's stable id, then skip if we
// already have a complete fetch for it. Done before spending any paid credit.
const canon = await resolveUrl(url);
skipIfDuplicate(canon?.id, canon?.resolvedFrom ? 'redirect-precheck' : 'url-precheck');

// ---- api key (stdin only) ----
const apiKeys = parseApiKeys(apiKeyFromStdin ? await readStdinText() : null);
if (!apiKeys.scrapeCreatorsApiKey) { console.error('No SCRAPECREATORS_API_KEY found.'); console.error(SURFACE); process.exit(2); }

const fmtTime = (ms) => {
  const s = Math.floor((ms || 0) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
};
// One segment per line, prefixed with [m:ss] / [h:mm:ss] when an offset exists.
const renderTimestamped = (segs) => segs.map((s) => (s.offset != null ? `[${fmtTime(s.offset)}] ${s.text}` : s.text)).join('\n');
const hasTimestamps = (segs) => segs.some((s) => s.offset != null);

// ---- main ----
const platform = canon?.platform;
if (!platform) {
  console.error(`[social-fetch] URL NOT SUPPORTED — could not determine a supported platform from ${url}`);
  console.error(SURFACE);
  process.exit(3);
}

// Use the canonical URL for API calls — providers (e.g. ScrapeCreators) reject
// some valid input shapes like IG `/reels/<id>` and require the normalized
// `/reel/<id>`. The resolver already produced that canonical form.
const fetchUrl = canon?.canonicalUrl || url;
const meta = await getMetadata(apiKeys, platform, fetchUrl);
if (meta.status !== 200 || !meta.body?.id) {
  console.error(`[social-fetch] METADATA ERROR — HTTP ${meta.status}: ${JSON.stringify(meta.body)}`);
  console.error(SURFACE);
  process.exit(3);
}
const m = meta.body;
// File/dedup key = the deterministic, URL-derived canonical id (the post's
// SHORTCODE for IG, the stable video id for other platforms), NOT the provider's
// numeric media id (which differs per provider and would orphan files on a
// provider swap). Fall back to the provider id only when the URL had no id.
const keyId = canon?.id || m.id;
// GATE 2 — authoritative backstop on the canonical id, before the costly
// transcript call. Catches URL shapes GATE 1's regex didn't recognize.
skipIfDuplicate(keyId, 'metadata-id');
const durationSeconds = m.media?.duration ?? m.duration ?? null;
const t = await getTranscript(apiKeys, platform, fetchUrl, { durationSeconds });
const id = sanitizeId(keyId);
const dir = socialDir;
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${platform}-${id}.txt`); // .txt = not ingested by sync (disk-only provenance)

const timestamped = t.state === 'ok' && hasTimestamps(t.segments);
const transcriptBlock = t.state === 'ok'
  ? renderTimestamped(t.segments)
  : t.state === 'empty'
    ? '_(no transcript available — clean response, no captions/audio)_'
    : `_(TRANSCRIPT ERROR — ${t.error})_`;
const transcriptHeading = timestamped ? '## Transcript (timestamped)' : '## Transcript';

const front = {
  ...m,
  _source_url: url,
  _canonical_url: canon?.canonicalUrl || null,
  _duration: durationSeconds,
  _fetched_at: new Date().toISOString(),
  _provider: 'scrapecreators',
  _transcript_provider: t.provider || 'scrapecreators',
  _transcript_state: t.state,
  _transcript_timestamped: timestamped,
};
const fm = Object.entries(front).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n');

const out = `---
${fm}
---

# ${m.title || `${platform} ${m.type || 'post'} by ${m.author?.username || 'unknown'}`}

**Source:** ${canon?.canonicalUrl || url}
**Platform:** ${platform} · **Author:** ${m.author?.displayName || m.author?.username || 'unknown'} · **Posted:** ${m.createdAt || 'unknown'}

## Description

${(m.description || '').trim() || '_(none)_'}

${transcriptHeading}

${transcriptBlock}
`;

fs.writeFileSync(file, out, 'utf8');
console.log(file); // path, for the caller

if (t.state === 'error') {
  console.error(`[social-fetch] TRANSCRIPT ERROR — ${t.error}`);
  console.error(`[social-fetch] Metadata was saved to ${file}, but the transcript failed. Do NOT build the concept page yet.`);
  console.error(SURFACE);
  process.exit(4);
}
if (t.state === 'empty') {
  console.error(`[social-fetch] wrote ${file} — NO transcript available (no captions/audio). Flagging so you can decide whether to proceed.`);
  process.exit(0);
}
console.error(`[social-fetch] wrote ${file} (transcript: yes)`);

// GATE 3 — cross-platform content dedup. The id-gate is per-platform, so the SAME
// clip cross-posted to another platform (different url + id) slips past it. Compare
// this transcript against every other sidecar; a high match = same video reposted.
// Needs the transcript, so it runs here (post-fetch) — it guards against a duplicate
// PAGE, not the credit. Surfaced for a human call; never auto-skips.
const dupes = findContentDuplicates(t.text, dir, { selfId: String(m.id) });
if (dupes.length) {
  const thisDur = m.media?.duration ?? m.duration ?? null;
  console.error('[social-fetch] ⚠ POSSIBLE DUPLICATE CONTENT — this transcript matches already-saved video(s).');
  console.error(`   new (just fetched): ${file}`);
  for (const d of dupes.slice(0, 3)) {
    const durs = (thisDur && d.duration) ? ` [this ~${Math.round(thisDur)}s vs saved ~${Math.round(d.duration)}s]` : '';
    const tag = d.reason === 'subset'
      ? `CLIP-OF-A-CLIP — ${Math.round(d.overlap * 100)}% of the shorter video is contained in the other${durs}`
      : `${Math.round(d.similarity * 100)}% near-identical (likely cross-platform repost)`;
    console.error(`   • ${tag} — ${d.platform} ${d.id} ${d.url}`);
    console.error(`       raw sidecar:  ${d.file}`);
    const pages = findCitingPages(brain, [path.basename(d.file), d.url].filter(Boolean));
    if (pages.length) for (const p of pages) console.error(`       concept page: ${p}`);
    else console.error('       concept page: (none found — raw sidecar only; no page was filed from this match)');
  }
  console.error('[social-fetch] SURFACE TO ELLIOT before filing. Same clip / cross-post / longer-or-shorter cut? Read the files above to compare. Prefer adding this URL as an extra source on the EXISTING concept page (note any duration difference) over creating a duplicate page.');
}
