// Tests for content-fingerprint.mjs — run: node --test skills/media-ingest/scripts/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalize, shingles, jaccard, overlap, extractTranscript, findContentDuplicates } from './content-fingerprint.mjs';

// A ~30-word clip and AB = A followed by ~30 more words (A is the first half of AB).
const CLIP_A = 'the first habit is the thirty day rule which means you should frame everything as a thirty day challenge and commit to doing it daily without breaking the streak at all';
// Much longer remainder so AB is ~3x A — the realistic "1-min clip inside a 3-min video"
// case where Jaccard clearly drops below threshold but the clip is fully contained.
const CLIP_EXTRA = 'the second habit is the serendipity hour where you block one full hour every single day to manufacture luck by cold messaging people you deeply admire applying to opportunities that feel far out of reach and following up relentlessly until they finally respond then the third habit is the ten thousand dollar task audit where each week you carefully separate low value busywork from the high leverage work that actually moves your whole life forward and you ruthlessly protect your calendar for the latter while delegating or deleting the rest entirely';
const CLIP_AB = `${CLIP_A} ${CLIP_EXTRA}`;

const A = 'This strategy proves that values sell. They could have just shown the product, but instead they led with the value behind it and got eleven million views.';
// Same clip, different platform auto-captions: a couple of words differ / repunctuated.
const A2 = '[0:00] this strategy proves that values sell [0:05] they couldve just shown the product but instead they led with the value behind it and got 11 million views';
// Different video, same creator, shares a generic intro phrase only.
const B = 'This strategy proves that you should post every single day for thirty days straight, because consistency is the only thing that actually builds an audience over time.';

test('normalize: strips timestamps, case and punctuation', () => {
  assert.equal(normalize('[0:12] Hello, WORLD!!'), 'hello world');
});

test('identical transcript -> jaccard 1.0', () => {
  assert.equal(jaccard(shingles(A), shingles(A)), 1);
});

test('same clip, different captions -> high bigram similarity (cross-post caught)', () => {
  const sim = jaccard(shingles(A, 2), shingles(A2, 2));
  assert.ok(sim >= 0.5, `expected >=0.5, got ${sim}`);
});

test('different video sharing only an intro phrase -> low bigram similarity', () => {
  const sim = jaccard(shingles(A, 2), shingles(B, 2));
  assert.ok(sim < 0.3, `expected <0.3, got ${sim}`);
});

test('non-English (Cyrillic) transcripts are NOT dropped — Unicode-aware normalize', () => {
  const ru = '[0:00] Привет, это тест! Мы говорим о привычках и продуктивности.';
  assert.equal(normalize(ru), 'привет это тест мы говорим о привычках и продуктивности');
  // same Russian clip with platform caption drift still matches itself strongly
  const ru2 = 'привет это тест мы говорим о привычках и о продуктивности каждый день';
  assert.ok(jaccard(shingles(ru, 2), shingles(ru2, 2)) >= 0.5);
});

test('short text falls back to word set', () => {
  assert.deepEqual([...shingles('hi there', 4)], ['hi', 'there']);
});

test('extractTranscript pulls the body after the heading', () => {
  const file = `---\nid: "X"\n---\n\n# title\n\n## Transcript (timestamped)\n\n[0:00] hello world\n`;
  assert.equal(extractTranscript(file), '[0:00] hello world');
});

test('findContentDuplicates flags a cross-platform repost and excludes self', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-'));
  const mk = (id, platform, url, transcript) =>
    fs.writeFileSync(path.join(dir, `${platform}-${id}.txt`),
      `---\nplatform: "${platform}"\nid: "${id}"\n_canonical_url: "${url}"\n---\n\n## Transcript\n\n${transcript}\n`);
  mk('IG1', 'instagram', 'https://www.instagram.com/reel/IG1/', A);
  mk('TT1', 'tiktok', 'https://www.tiktok.com/@x/video/123', A2); // same clip, other platform
  mk('IG2', 'instagram', 'https://www.instagram.com/reel/IG2/', B); // unrelated

  const hits = findContentDuplicates(A, dir, { selfId: 'IG1' });
  assert.equal(hits.length, 1, 'only the cross-posted clip should match');
  assert.equal(hits[0].id, 'TT1');
  assert.equal(hits[0].platform, 'tiktok');
  assert.ok(hits[0].similarity >= 0.6);
  assert.ok(path.isAbsolute(hits[0].file), 'file path must be absolute for the caller to read');
  assert.equal(hits[0].file, path.join(dir, 'tiktok-TT1.txt'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('overlap coefficient: a clip contained in a longer cut scores ~1.0 where Jaccard does not', () => {
  const a = shingles(CLIP_A, 2), ab = shingles(CLIP_AB, 2);
  assert.ok(overlap(a, ab) >= 0.95, `overlap expected ~1.0, got ${overlap(a, ab)}`);
  assert.ok(jaccard(a, ab) < 0.5, `jaccard expected <0.5 (why overlap is needed), got ${jaccard(a, ab)}`);
});

test('clip-of-a-clip is flagged as subset (both directions)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-'));
  const mk = (id, transcript) => fs.writeFileSync(path.join(dir, `instagram-${id}.txt`),
    `---\nplatform: "instagram"\nid: "${id}"\n_canonical_url: "https://www.instagram.com/reel/${id}/"\n---\n\n## Transcript\n\n${transcript}\n`);

  // saving the SHORT clip when the LONG cut already exists
  mk('LONG', CLIP_AB);
  let hits = findContentDuplicates(CLIP_A, dir, {});
  assert.equal(hits.length, 1);
  assert.equal(hits[0].reason, 'subset');
  assert.ok(hits[0].overlap >= 0.95);

  // saving the LONG cut when the SHORT clip already exists
  fs.rmSync(path.join(dir, 'instagram-LONG.txt'));
  mk('SHORT', CLIP_A);
  hits = findContentDuplicates(CLIP_AB, dir, {});
  assert.equal(hits.length, 1);
  assert.equal(hits[0].reason, 'subset');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a tiny fragment that appears inside a long video is NOT flagged (min-size guard)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-'));
  fs.writeFileSync(path.join(dir, 'instagram-LONG.txt'),
    `---\nplatform: "instagram"\nid: "LONG"\n---\n\n## Transcript\n\n${CLIP_AB}\n`);
  // "thirty day rule" is literally inside CLIP_AB but far too short to trust
  assert.equal(findContentDuplicates('thirty day rule', dir, {}).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('findContentDuplicates returns nothing when the corpus is unrelated', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-'));
  fs.writeFileSync(path.join(dir, 'instagram-Z.txt'), `---\nplatform: "instagram"\nid: "Z"\n---\n\n## Transcript\n\n${B}\n`);
  assert.equal(findContentDuplicates(A, dir, {}).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
