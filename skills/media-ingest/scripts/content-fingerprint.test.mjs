// Tests for content-fingerprint.mjs — run: node --test skills/media-ingest/scripts/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalize, sha256, shingles, jaccard, extractTranscript, findContentDuplicates } from './content-fingerprint.mjs';

const A = 'This strategy proves that values sell. They could have just shown the product, but instead they led with the value behind it and got eleven million views.';
// Same clip, different platform auto-captions: a couple of words differ / repunctuated.
const A2 = '[0:00] this strategy proves that values sell [0:05] they couldve just shown the product but instead they led with the value behind it and got 11 million views';
// Different video, same creator, shares a generic intro phrase only.
const B = 'This strategy proves that you should post every single day for thirty days straight, because consistency is the only thing that actually builds an audience over time.';

test('normalize: strips timestamps, case and punctuation', () => {
  assert.equal(normalize('[0:12] Hello, WORLD!!'), 'hello world');
});

test('sha256 is invariant to timestamps/case/punctuation', () => {
  assert.equal(sha256('Hello world'), sha256('[0:00] hello, WORLD!'));
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
  fs.rmSync(dir, { recursive: true, force: true });
});

test('findContentDuplicates returns nothing when the corpus is unrelated', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-'));
  fs.writeFileSync(path.join(dir, 'instagram-Z.txt'), `---\nplatform: "instagram"\nid: "Z"\n---\n\n## Transcript\n\n${B}\n`);
  assert.equal(findContentDuplicates(A, dir, {}).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
