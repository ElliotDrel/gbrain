#!/usr/bin/env node
// concept-dedup.mjs — "build, don't duplicate" gate for CONCEPTS.
//
// Gates 1-3 (in social-fetch.mjs / content-fingerprint.mjs) dedup the same VIDEO
// (url, transcript, clip). This is a different problem: two *different* videos can
// express the SAME idea in different words — almost no shared n-grams, so transcript
// matching can't see it. Idea-similarity is SEMANTIC, so we use the brain's own
// hybrid (vector+keyword) search: before filing a new concept page, search for the
// proposed takeaway and surface existing concept pages that already cover it — so we
// build on / cross-link them instead of saving a near-duplicate.
//
// This is a SURFACING aid, not an auto-skip: "is this the same core idea?" and
// "merge vs cross-link vs new" are judgment calls. gbrain's RRF scores aren't
// normalized (they can exceed 1), so we rank + show the top candidates and let the
// AI read and decide — we never auto-merge.
//
// Usage:  node concept-dedup.mjs "<core takeaway / concept in plain words>" [--brain <dir>] [--limit N] [--exclude <slug>]
// Output: ranked existing concept pages (score, absolute path, excerpt) on stderr;
//         the matched slugs on stdout (one per line) for programmatic use.

import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

// Parse gbrain query's "[score] slug -- excerpt" lines into ranked candidates of a
// given type prefix. Pure + testable. Dedupes by slug (keeps best score), sorts desc.
export function parseQueryOutput(text, { typePrefix = 'concepts/', brain = '', exclude = null } = {}) {
  const LINE = /^\[(\d+(?:\.\d+)?)\]\s+(\S+)\s+--\s+(.*)$/;
  const best = new Map();
  for (const line of String(text).split('\n')) {
    const m = line.match(LINE);
    if (!m) continue;
    const [, score, slug, excerpt] = m;
    if (typePrefix && !slug.startsWith(typePrefix)) continue;
    if (exclude && slug === exclude) continue;
    const rec = { score: Number(score), slug, excerpt: excerpt.trim(), file: brain ? path.join(brain, `${slug}.md`) : `${slug}.md` };
    if (!best.has(slug) || rec.score > best.get(slug).score) best.set(slug, rec);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

// Run the brain's hybrid search and return ranked concept candidates. `runner` is
// injectable for tests; default shells out to gbrain in the brain dir.
export function findRelatedConcepts(query, { brain, limit = 10, typePrefix = 'concepts/', exclude = null, runner = null } = {}) {
  const run = runner || ((q) => {
    try { return execFileSync('gbrain', ['query', q, '--limit', String(limit)], { cwd: brain, encoding: 'utf8' }); }
    catch (e) { return (e.stdout ? e.stdout.toString() : ''); } // gbrain may exit non-zero but still print
  });
  let text = '';
  try { text = run(query); } catch { return []; } // gbrain unavailable / runner threw -> no candidates
  return parseQueryOutput(text, { typePrefix, brain, exclude });
}

// ---- CLI ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const query = argv.find((a) => !a.startsWith('-'));
  const arg = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
  const brain = path.resolve(arg('--brain', path.join(os.homedir(), 'brain')));
  const limit = Number(arg('--limit', '10'));
  const exclude = arg('--exclude', null);
  if (!query) { console.error('Usage: node concept-dedup.mjs "<takeaway>" [--brain <dir>] [--limit N] [--exclude <slug>]'); process.exit(1); }

  const hits = findRelatedConcepts(query, { brain, limit, exclude }).slice(0, 6);
  if (!hits.length) {
    console.error(`[concept-dedup] No existing concept pages came up for: "${query}"`);
    console.error('[concept-dedup] Looks novel — safe to file a new concept page (still cross-link any related entities).');
    process.exit(0);
  }
  console.error(`[concept-dedup] BUILD-DON'T-DUPLICATE — existing concepts close to: "${query}"`);
  for (const h of hits) {
    console.error(`   • ${h.score.toFixed(2)}  ${h.slug}`);
    console.error(`       ${h.file}`);
    console.error(`       excerpt: ${h.excerpt.slice(0, 140)}`);
  }
  console.error('[concept-dedup] READ the close ones. If one expresses the SAME core idea, BUILD on it (add this video as a corroborating source + any new angle/example, cross-link the creator) instead of filing a near-duplicate. If related-but-distinct, file new + cross-link both ways (## See Also). Surface the merge-vs-new call to Elliot when unsure.');
  for (const h of hits) console.log(h.slug); // stdout = slugs, for programmatic use
}
