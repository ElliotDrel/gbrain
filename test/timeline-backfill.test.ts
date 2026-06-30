import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { importFromContent } from '../src/core/import-file.ts';
import { runTimelineBackfill } from '../src/commands/timeline-backfill.ts';

let engine: PGLiteEngine;

async function truncateAll() {
  const tables = [
    'content_chunks', 'links', 'tags', 'raw_data',
    'timeline_entries', 'page_versions', 'ingest_log', 'pages',
  ];
  for (const t of tables) {
    await (engine as any).db.exec(`DELETE FROM ${t}`);
  }
}

// Simulate a brain whose pages predate the live timeline-event emission:
// keep the pages, drop every timeline row.
async function clearTimeline() {
  await (engine as any).db.exec(`DELETE FROM timeline_entries`);
}

beforeAll(async () => {
  engine = new PGLiteEngine();
  await engine.connect({});
  await engine.initSchema();
});

afterAll(async () => {
  await engine.disconnect();
});

async function seedPages() {
  await importFromContent(engine, 'people/roy-lee', `---
title: Roy Lee
type: person
reference: true
date: 2026-01-02
---

Roy Lee writes things.
`, { noEmbed: true });

  await importFromContent(engine, 'sources/roy-lee-post', `---
title: Roy Article
type: source
date: 2026-06-30
---

Roy Lee said something useful here.
`, { noEmbed: true });
}

describe('timeline-backfill command', () => {
  beforeEach(truncateAll);

  test('created backfill adds system:page-created for pages missing it', async () => {
    await seedPages();
    await clearTimeline();

    await runTimelineBackfill(engine, ['--created', '--json']);

    const person = await engine.getTimeline('people/roy-lee');
    const source = await engine.getTimeline('sources/roy-lee-post');
    // date = effective_date (from frontmatter `date`) — matches live putPage.
    expect(person.some((e) => e.source === 'system:page-created' && e.summary === 'Created'
      && e.date.toISOString().slice(0, 10) === '2026-01-02')).toBe(true);
    expect(source.some((e) => e.source === 'system:page-created' && e.summary === 'Created'
      && e.date.toISOString().slice(0, 10) === '2026-06-30')).toBe(true);
  });

  test('citations backfill re-emits reference-citation events', async () => {
    await seedPages();
    await clearTimeline();

    await runTimelineBackfill(engine, ['--citations', '--json']);

    const person = await engine.getTimeline('people/roy-lee');
    expect(person.some((e) => e.source === 'reference-citation:default::sources/roy-lee-post'
      && e.summary === 'Referenced in sources/roy-lee-post'
      && e.date.toISOString().slice(0, 10) === '2026-06-30')).toBe(true);
  });

  test('backfill is idempotent — a second run inserts no duplicates', async () => {
    await seedPages();
    await clearTimeline();

    await runTimelineBackfill(engine, ['--json']);
    await runTimelineBackfill(engine, ['--json']);

    const person = await engine.getTimeline('people/roy-lee');
    const created = person.filter((e) => e.source === 'system:page-created');
    const cited = person.filter((e) => e.source === 'reference-citation:default::sources/roy-lee-post');
    expect(created).toHaveLength(1);
    expect(cited).toHaveLength(1);
  });
});
