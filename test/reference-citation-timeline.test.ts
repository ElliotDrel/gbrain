import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { importFromContent } from '../src/core/import-file.ts';

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

beforeAll(async () => {
  engine = new PGLiteEngine();
  await engine.connect({});
  await engine.initSchema();
});

afterAll(async () => {
  await engine.disconnect();
});

describe('reference citation timeline', () => {
  beforeEach(truncateAll);

  test('importing a source page adds a deterministic reference citation event', async () => {
    await importFromContent(engine, 'people/roy-lee', `---
title: Roy Lee
type: person
reference: true
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

    const entries = await engine.getTimeline('people/roy-lee');
    expect(entries.some((e) =>
      e.source === 'reference-citation:default::sources/roy-lee-post'
      && e.summary === 'Referenced in sources/roy-lee-post'
      && e.date.toISOString().slice(0, 10) === '2026-06-30'
    )).toBe(true);
  });

  test('remote source imports do not create reference citation events', async () => {
    await importFromContent(engine, 'people/roy-lee', `---
title: Roy Lee
type: person
reference: true
---

Roy Lee writes things.
`, { noEmbed: true });

    await importFromContent(engine, 'sources/remote-roy', `---
title: Remote Roy Article
type: source
date: 2026-06-30
---

Roy Lee said something useful here.
`, { noEmbed: true, remote: true });

    const entries = await engine.getTimeline('people/roy-lee');
    expect(entries.some((e) => e.source === 'reference-citation:default::sources/remote-roy')).toBe(false);
  });

  test('re-import with a changed source title does not duplicate the citation event', async () => {
    await importFromContent(engine, 'people/roy-lee', `---
title: Roy Lee
type: person
reference: true
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

    await importFromContent(engine, 'sources/roy-lee-post', `---
title: Retitled Roy Article
type: source
date: 2026-06-30
---

Roy Lee said something useful here.
`, { noEmbed: true });

    const entries = await engine.getTimeline('people/roy-lee');
    const citations = entries.filter((e) => e.source === 'reference-citation:default::sources/roy-lee-post');
    expect(citations).toHaveLength(1);
    expect(citations[0]?.summary).toBe('Referenced in sources/roy-lee-post');
  });
});
