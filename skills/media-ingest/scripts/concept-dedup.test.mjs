// Tests for concept-dedup.mjs — run: node --test skills/media-ingest/scripts/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseQueryOutput, findRelatedConcepts } from './concept-dedup.mjs';

// Realistic gbrain query output (scores are RRF-fused; can exceed 1).
const SAMPLE = `
[0.8668] concepts/buffett-5-25-rule -- # Buffett's 5/25 Rule (Avoid-at-All-Costs List)
[1.0175] concepts/okrs -- The point is a target you can't reach by incremental progress.
[0.4051] concepts/longevity-health-protocol -- The body is a clock and loves routine.
[0.8892] concepts/cognitive-load-partitioning -- reframes underperformance as a bandwidth problem
[0.5805] people/caleb-ralston -- # Caleb Ralston
[0.8668] concepts/buffett-5-25-rule -- # duplicate slug lower down
`;

test('parses [score] slug -- excerpt, filters to concepts/, dedupes, sorts desc', () => {
  const r = parseQueryOutput(SAMPLE, { brain: '/home/supe/brain' });
  assert.deepEqual(r.map((x) => x.slug), [
    'concepts/okrs',
    'concepts/cognitive-load-partitioning',
    'concepts/buffett-5-25-rule',
    'concepts/longevity-health-protocol',
  ]);
  // people/ filtered out
  assert.ok(!r.some((x) => x.slug.startsWith('people/')));
});

test('builds absolute .md file paths from the brain dir', () => {
  const r = parseQueryOutput(SAMPLE, { brain: '/home/supe/brain' });
  const okrs = r.find((x) => x.slug === 'concepts/okrs');
  assert.equal(okrs.file, path.join('/home/supe/brain', 'concepts/okrs.md'));
  assert.ok(path.isAbsolute(okrs.file));
});

test('excerpt preserves text after the first " -- " (including any later --)', () => {
  const r = parseQueryOutput('[0.9] concepts/x -- a take -- with dashes', {});
  assert.equal(r[0].excerpt, 'a take -- with dashes');
});

test('--exclude drops the page being re-checked', () => {
  const r = parseQueryOutput(SAMPLE, { exclude: 'concepts/okrs' });
  assert.ok(!r.some((x) => x.slug === 'concepts/okrs'));
});

test('garbage / empty output yields no candidates', () => {
  assert.equal(parseQueryOutput('', {}).length, 0);
  assert.equal(parseQueryOutput('no brackets here\nmonkey', {}).length, 0);
});

test('findRelatedConcepts uses an injected runner and ranks results', () => {
  const r = findRelatedConcepts('focus on a few priorities', {
    brain: '/b', runner: () => SAMPLE,
  });
  assert.equal(r[0].slug, 'concepts/okrs');
  assert.equal(r[0].file, '/b/concepts/okrs.md');
});

test('findRelatedConcepts survives a throwing runner (returns [])', () => {
  const r = findRelatedConcepts('x', { brain: '/b', runner: () => { throw new Error('gbrain missing'); } });
  assert.deepEqual(r, []);
});
