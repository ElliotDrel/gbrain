#!/usr/bin/env node
// social-fetch.mjs — fetch a social/video URL's transcript + metadata via
// Supadata and write ONE raw file: <brain>/sources/social/<platform>-<id>.txt
//
// NOTE: the file is .txt ON PURPOSE. gbrain sync only ingests .md pages into
// the engine, so a .txt keeps the raw as disk-only provenance (same mechanism
// meetings use for their .raw transcripts) — it never pollutes search.
//
// Keep it simple. Two API calls (metadata + transcript), one file out.
//
// ONE ATTEMPT ONLY. Supadata credits are billed per request, so this script
// NEVER retries on errors. If anything goes wrong (bad status code, failed/
// timed-out job), it stops, prints the exact HTTP status + body, and exits
// non-zero with a loud ">>> SURFACE THIS TO THE USER" line. The caller (the
// media-ingest skill / the AI) MUST relay that to Elliot for troubleshooting
// instead of silently re-running and wasting credits.
//
// DEDUP: this post may already be on disk. Each fetch is keyed by the post's
// canonical shortcode/id (the .txt filename suffix), so we refuse to re-fetch a
// post we already have a COMPLETE transcript for — two gates:
//   (1) free URL pre-check BEFORE any API call (no credits, dodges rate limits)
//   (2) authoritative backstop AFTER metadata, BEFORE the costly transcript call
// An incomplete prior fetch (_transcript_state empty/error) is NOT a duplicate —
// it re-fetches to finish. Pass --force to re-fetch deliberately (bills credits).
//
// Usage:  node social-fetch.mjs <url> [--brain <dir>] [--force]
// Output: prints the written (or already-existing) file path as the last stdout line.
// Exit:   0 ok / already-ingested · 1 usage · 2 no api key · 3 metadata error · 4 transcript error

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolve as resolveUrl } from './canonical-url.mjs';
import { sha256 as transcriptSha, findContentDuplicates } from './content-fingerprint.mjs';

const BASE = 'https://api.supadata.ai/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SURFACE = '>>> SURFACE THIS TO THE USER. One attempt only was made — Supadata credits are billed per request, so do NOT auto-retry. Troubleshoot with Elliot first.';

// ---- args ----
const argv = process.argv.slice(2);
const url = argv.find((a) => !a.startsWith('-'));
const force = argv.includes('--force');
const brain = (() => { const i = argv.indexOf('--brain'); return i >= 0 ? argv[i + 1] : path.join(os.homedir(), 'brain'); })();
if (!url) { console.error('Usage: node social-fetch.mjs <url> [--brain <dir>] [--force]'); process.exit(1); }

// ---- dedup (deterministic, keyed by the post's canonical shortcode/id) ----
const socialDir = path.join(brain, 'sources', 'social');
const sanitizeId = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_');
// Path of an already-COMPLETE fetch (.txt with _transcript_state: "ok") for this
// id, else null. A file whose prior fetch was empty/error is treated as absent
// so we re-fetch and finish it.
function existingOkFile(id) {
  if (!id) return null;
  const want = sanitizeId(id);
  try {
    for (const f of fs.readdirSync(socialDir)) {
      if (!f.endsWith(`-${want}.txt`)) continue;
      const head = fs.readFileSync(path.join(socialDir, f), 'utf8').slice(0, 4000);
      return /^_transcript_state:\s*"ok"/m.test(head) ? path.join(socialDir, f) : null;
    }
  } catch { /* dir missing on first run */ }
  return null;
}
function skipIfDuplicate(id, stage) {
  if (force) return;
  const hit = existingOkFile(id);
  if (!hit) return;
  console.log(hit); // path, for the caller — same stdout contract as a fresh write
  console.error(`[social-fetch] ALREADY INGESTED (${stage}) — ${hit}`);
  console.error('[social-fetch] Skipped: this post already has a complete transcript on disk. Re-run with --force to re-fetch (bills credits). Surface to Elliot — do NOT silently re-file a duplicate concept page.');
  process.exit(0);
}
// GATE 1 — canonicalize the URL (handles share/short links via a FREE redirect
// follow — NOT a Supadata credit) to get the post's stable id, then skip if we
// already have a complete fetch for it. Done before spending any paid credit.
const canon = await resolveUrl(url);
skipIfDuplicate(canon?.id, canon?.resolvedFrom ? 'redirect-precheck' : 'url-precheck');

// ---- api key (env, then openclaw.json) ----
const apiKey = process.env.SUPADATA_API_KEY
  || (() => { try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.openclaw/openclaw.json'), 'utf8'))?.mcp?.servers?.supadata?.env?.SUPADATA_API_KEY; } catch { return null; } })();
if (!apiKey) { console.error('No SUPADATA_API_KEY found.'); console.error(SURFACE); process.exit(2); }

// ---- one GET, NO retries ----
async function get(endpoint, params) {
  const u = new URL(BASE + endpoint);
  for (const [k, v] of Object.entries(params || {})) if (v != null) u.searchParams.set(k, String(v));
  const res = await fetch(u, { headers: { 'x-api-key': apiKey } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// We request text=false so Supadata returns TIMESTAMPED segments
// ({content:[{text, offset(ms), duration(ms)}]}) instead of a flat string.
// We don't cite timestamps today, but storing them means we never have to
// re-fetch (and re-bill) to get them later. Defensively handle a plain-string
// body too (some AI-generated fallbacks return no offsets).
const fmtTime = (ms) => {
  const s = Math.floor((ms || 0) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
};
const segmentsOf = (b) => Array.isArray(b?.content)
  ? b.content.filter((c) => c && c.text != null).map((c) => ({ text: String(c.text).trim(), offset: c.offset ?? c.start ?? null }))
  : (typeof b?.content === 'string' && b.content.trim() ? [{ text: b.content.trim(), offset: null }] : []);
const plainOf = (segs) => segs.map((s) => s.text).join(' ').trim();
// One segment per line, prefixed with [m:ss] / [h:mm:ss] when an offset exists.
const renderTimestamped = (segs) => segs.map((s) => (s.offset != null ? `[${fmtTime(s.offset)}] ${s.text}` : s.text)).join('\n');
const hasTimestamps = (segs) => segs.some((s) => s.offset != null);

// ONE transcript request. mode=auto = native captions with server-side AI
// generation fallback in a single billed call. 202 → poll the SAME job to
// completion (polling status is not a new transcription request).
// Returns { state: 'ok'|'empty'|'error', text, segments, error }.
async function getTranscript() {
  const r = await get('/transcript', { url, text: false, mode: 'auto' });
  if (r.status === 200) { const segs = segmentsOf(r.body); const t = plainOf(segs); return { state: t ? 'ok' : 'empty', text: t, segments: segs, error: null }; }
  if (r.status === 202 && r.body?.jobId) {
    const deadline = Date.now() + 120_000; // generation can take a while
    while (Date.now() < deadline) {
      await sleep(3000);
      const j = await get(`/transcript/${encodeURIComponent(r.body.jobId)}`, {});
      if (j.status !== 200) return { state: 'error', text: '', segments: [], error: `job poll HTTP ${j.status}: ${JSON.stringify(j.body)}` };
      if (j.body?.status === 'completed') { const segs = segmentsOf(j.body); const t = plainOf(segs); return { state: t ? 'ok' : 'empty', text: t, segments: segs, error: null }; }
      if (j.body?.status === 'failed') return { state: 'error', text: '', segments: [], error: `transcript job failed: ${JSON.stringify(j.body)}` };
    }
    return { state: 'error', text: '', segments: [], error: 'transcript job timed out after 120s' };
  }
  return { state: 'error', text: '', segments: [], error: `HTTP ${r.status}: ${JSON.stringify(r.body)}` };
}

// ---- main ----
const meta = await get('/metadata', { url });
if (meta.status !== 200 || !meta.body?.id) {
  console.error(`[social-fetch] METADATA ERROR — HTTP ${meta.status}: ${JSON.stringify(meta.body)}`);
  console.error(SURFACE);
  process.exit(3);
}
const m = meta.body;
// GATE 2 — authoritative backstop on the canonical id, before the costly
// transcript call. Catches URL shapes GATE 1's regex didn't recognize.
skipIfDuplicate(m.id, 'metadata-id');
const t = await getTranscript();

const platform = String(m.platform || 'unknown').toLowerCase();
const id = sanitizeId(m.id);
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

const front = { ...m, _source_url: url, _canonical_url: canon?.canonicalUrl || null, _duration: m.media?.duration ?? m.duration ?? null, _transcript_sha: t.state === 'ok' ? transcriptSha(t.text) : null, _fetched_at: new Date().toISOString(), _transcript_state: t.state, _transcript_timestamped: timestamped };
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
  console.error('[social-fetch] ⚠ POSSIBLE DUPLICATE CONTENT — this transcript matches already-saved video(s):');
  for (const d of dupes.slice(0, 3)) {
    const durs = (thisDur && d.duration) ? ` [this ~${Math.round(thisDur)}s vs saved ~${Math.round(d.duration)}s]` : '';
    const tag = d.reason === 'subset'
      ? `CLIP-OF-A-CLIP — ${Math.round(d.overlap * 100)}% of the shorter video is contained in the other${durs}`
      : `${Math.round(d.similarity * 100)}% near-identical (likely cross-platform repost)`;
    console.error(`   • ${tag} — ${d.platform} ${d.id} — ${d.url || d.file}`);
  }
  console.error('[social-fetch] SURFACE TO ELLIOT before filing. Same clip / cross-post / longer-or-shorter cut? Prefer adding this URL as an extra source on the EXISTING concept page (note the duration difference) over creating a duplicate page.');
}
