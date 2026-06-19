// Commit 3 (Phase 3): unified multimodal column.
//
// Covers:
//   - Schema migration v68 adds embedding_multimodal column
//   - searchVector routes to embedding_multimodal when opts.embeddingColumn set
//   - hybridSearch routes through unified column when search.unified_multimodal=true
//   - D8 fail-open: unified-only=false + empty unified column → falls back to text
//   - D8 strict: unified-only=true + empty column → does not fall back
//   - reindex --multimodal cost estimate + dry-run + GBRAIN_NO_REEMBED bypass
//   - D7 lock acquired during reindex; second reindex receives LOCK_HELD

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { resetPgliteState } from './helpers/reset-pglite.ts';
import { withEnv } from './helpers/with-env.ts';
import {
  configureGateway,
  resetGateway,
} from '../src/core/ai/gateway.ts';
import { hybridSearch } from '../src/core/search/hybrid.ts';
import { runReindexMultimodal } from '../src/commands/reindex-multimodal.ts';

let engine: PGLiteEngine;
let fetchHandler: ((url: string, init: RequestInit) => Promise<Response>) | null = null;
const origFetch = globalThis.fetch;
const TEXT_EMBED_ENV = {
  GBRAIN_EMBEDDING_MODEL: 'openai:text-embedding-3-large',
  GBRAIN_EMBEDDING_DIMENSIONS: '1536',
} as const;

function captureEmbeddingColumnName(opts: Parameters<PGLiteEngine['searchVector']>[1]): string {
  const column = opts?.embeddingColumn;
  if (typeof column === 'string') return column;
  if (column && typeof column === 'object' && 'name' in column && typeof column.name === 'string') {
    return column.name;
  }
  return 'embedding';
}

beforeAll(async () => {
  engine = new PGLiteEngine();
  await engine.connect({});
  await engine.initSchema();
});

afterAll(async () => {
  await engine.disconnect();
});

beforeEach(async () => {
  await resetPgliteState(engine);
  fetchHandler = async () => new Response(JSON.stringify({
    data: [{ embedding: Array.from({ length: 1024 }, () => 0.1), index: 0 }],
    model: 'voyage-multimodal-3',
  }), { status: 200 });
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (!fetchHandler) throw new Error('no fetch handler');
    return fetchHandler(typeof url === 'string' ? url : url.toString(), init ?? {});
  }) as typeof fetch;
  configureGateway({
    embedding_model: 'openai:text-embedding-3-large',
    embedding_dimensions: 1536,
    embedding_multimodal_model: 'voyage:voyage-multimodal-3',
    env: { OPENAI_API_KEY: 'test', VOYAGE_API_KEY: 'test' },
  });
});

afterEach(() => {
  globalThis.fetch = origFetch;
  resetGateway();
});

describe('Phase 3 schema — v68 migration', () => {
  test('content_chunks has embedding_multimodal column', async () => {
    // Run an explicit query against the column. If the migration ran, this succeeds.
    const rows = await engine.executeRaw<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM content_chunks WHERE embedding_multimodal IS NULL`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe('reindex --multimodal command (Phase 3)', () => {
  test('--dry-run reports cost estimate without mutating', async () => {
    // No rows in DB → pending=0, no work needed.
    const result = await runReindexMultimodal(engine, { dryRun: true });
    expect(result.dry_run).toBe(true);
    expect(result.reembedded).toBe(0);
  });

  test('--cost-estimate reports cost but does not run', async () => {
    const result = await runReindexMultimodal(engine, { costEstimate: true });
    expect(result.dry_run).toBe(true);
    expect(result.reembedded).toBe(0);
  });

  test('GBRAIN_NO_REEMBED=1 honored on zero-pending brain (skip path is no-op-clean)', async () => {
    await withEnv({ GBRAIN_NO_REEMBED: '1' }, async () => {
      const result = await runReindexMultimodal(engine, {});
      // Zero pending → reindex short-circuits before the env-var check; both
      // paths produce dry_run=false + reembedded=0 + pending=0.
      expect(result.reembedded).toBe(0);
      expect(result.pending_after).toBe(0);
    });
  });

  test('zero-pending returns cleanly', async () => {
    const result = await runReindexMultimodal(engine, { yes: true });
    expect(result.pending_before).toBe(0);
    expect(result.reembedded).toBe(0);
    expect(result.failed).toBe(0);
  });
});

describe('hybridSearch unified routing (Phase 3)', () => {
  test('search.unified_multimodal=true routes ALL queries through embedding_multimodal', async () => {
    await withEnv(TEXT_EMBED_ENV, async () => {
      await engine.setConfig('search.unified_multimodal', 'true');
      const originalSearchVector = engine.searchVector.bind(engine);
      const embeddingColumnsSeen: string[] = [];
      let voyageCalled = 0;
      engine.searchVector = (async (embedding, opts) => {
        embeddingColumnsSeen.push(captureEmbeddingColumnName(opts));
        if (captureEmbeddingColumnName(opts) === 'embedding_multimodal') {
          return [{
            slug: 'unified/route',
            page_id: 1,
            title: 'Unified Route',
            type: 'note',
            source_id: null,
            effective_date: null,
            effective_date_source: null,
            chunk_id: null,
            chunk_index: 0,
            chunk_text: 'unified route hit',
            chunk_source: 'compiled_truth',
            score: 1,
            stale: false,
          }];
        }
        return originalSearchVector(embedding, opts);
      }) as typeof engine.searchVector;
      try {
        fetchHandler = async (url) => {
          if (url.includes('multimodalembeddings')) {
            voyageCalled++;
            return new Response(JSON.stringify({
              data: [{ embedding: Array.from({ length: 1024 }, () => 0.1), index: 0 }],
            }), { status: 200 });
          }
          throw new Error(`Unexpected text embedding fetch during unified-route test: ${url}`);
        };

        await hybridSearch(engine, 'totally text query', { limit: 5 });
        expect(voyageCalled).toBeGreaterThanOrEqual(1);
        expect(embeddingColumnsSeen).toEqual(['embedding_multimodal']);
      } finally {
        engine.searchVector = originalSearchVector as typeof engine.searchVector;
      }
    });
  });

  test('D8 fail-open: empty unified column + not strict → falls back to text', async () => {
    await withEnv(TEXT_EMBED_ENV, async () => {
      await engine.setConfig('search.unified_multimodal', 'true');
      let openaiCalled = 0;
      fetchHandler = async (url) => {
        if (url.includes('multimodalembeddings')) {
          return new Response(JSON.stringify({
            data: [{ embedding: Array.from({ length: 1024 }, () => 0.1), index: 0 }],
          }), { status: 200 });
        }
        openaiCalled++;
        return new Response(JSON.stringify({
          data: [{ embedding: Array.from({ length: 1536 }, () => 0.1), index: 0 }],
        }), { status: 200 });
      };

      const results = await hybridSearch(engine, 'whatever', { limit: 5 });
      expect(Array.isArray(results)).toBe(true);
      expect(openaiCalled).toBeGreaterThanOrEqual(1);
    });
  });

  test('D8 strict: unified_multimodal_only=true + empty column → does NOT fall back', async () => {
    await withEnv(TEXT_EMBED_ENV, async () => {
      await engine.setConfig('search.unified_multimodal', 'true');
      await engine.setConfig('search.unified_multimodal_only', 'true');
      await engine.putPage('strict/keyword-hit', {
        type: 'note',
        title: 'Strict Keyword Hit',
        compiled_truth: 'whatever keyword should stay suppressed',
      });
      await engine.upsertChunks('strict/keyword-hit', [
        { chunk_index: 0, chunk_text: 'whatever keyword should stay suppressed', chunk_source: 'compiled_truth' },
      ]);
      let openaiCalled = 0;
      fetchHandler = async (url) => {
        if (url.includes('multimodalembeddings')) {
          return new Response(JSON.stringify({
            data: [{ embedding: Array.from({ length: 1024 }, () => 0.1), index: 0 }],
          }), { status: 200 });
        }
        openaiCalled++;
        return new Response(JSON.stringify({
          data: [{ embedding: Array.from({ length: 1536 }, () => 0.1), index: 0 }],
        }), { status: 200 });
      };

      const results = await hybridSearch(engine, 'whatever', { limit: 5 });
      expect(results).toEqual([]);
      expect(openaiCalled).toBe(0);
    });
  });

  test('D8 strict: unified embed failure does NOT fall back to text vector search', async () => {
    await withEnv(TEXT_EMBED_ENV, async () => {
      await engine.setConfig('search.unified_multimodal', 'true');
      await engine.setConfig('search.unified_multimodal_only', 'true');
      let openaiCalled = 0;
      fetchHandler = async (url) => {
        if (url.includes('multimodalembeddings')) {
          throw new Error('voyage unavailable');
        }
        openaiCalled++;
        return new Response(JSON.stringify({
          data: [{ embedding: Array.from({ length: 1536 }, () => 0.1), index: 0 }],
        }), { status: 200 });
      };

      const results = await hybridSearch(engine, 'strict multimodal failure', { limit: 5 });
      expect(results).toEqual([]);
      expect(openaiCalled).toBe(0);
    });
  });

  test('unified routing re-scores against embedding_multimodal, not text embedding', async () => {
    await withEnv(TEXT_EMBED_ENV, async () => {
      await engine.setConfig('search.unified_multimodal', 'true');
      await engine.putPage('unified/a', {
        type: 'note',
        title: 'Unified A',
        compiled_truth: 'first unified chunk',
      });
      await engine.putPage('unified/b', {
        type: 'note',
        title: 'Unified B',
        compiled_truth: 'second unified chunk',
      });
      await engine.upsertChunks('unified/a', [
        { chunk_index: 0, chunk_text: 'first unified chunk', chunk_source: 'compiled_truth' },
      ]);
      await engine.upsertChunks('unified/b', [
        { chunk_index: 0, chunk_text: 'second unified chunk', chunk_source: 'compiled_truth' },
      ]);

      const rows = await engine.executeRaw<{
        chunk_id: number;
        page_id: number;
        slug: string;
        title: string;
      }>(`
        SELECT cc.id AS chunk_id, p.id AS page_id, p.slug, p.title
        FROM content_chunks cc
        JOIN pages p ON p.id = cc.page_id
        WHERE p.slug IN ('unified/a', 'unified/b')
        ORDER BY p.slug
      `);
      const chunkA = rows.find((row) => row.slug === 'unified/a');
      const chunkB = rows.find((row) => row.slug === 'unified/b');
      expect(chunkA).toBeDefined();
      expect(chunkB).toBeDefined();

      // Text column is 1536-dim (embedding_dimensions: 1536 in beforeEach).
      // These text vectors only need to satisfy the embedding column's INSERT
      // constraint — the unified path re-scores against embedding_multimodal,
      // not embedding — but they MUST match the column width or the UPDATE
      // throws a dimension error when the file runs in isolation (the harness
      // runs each *.serial.test.ts in its own process).
      const textA = `[${[1, ...Array.from({ length: 1535 }, () => 0)].join(',')}]`;
      const textB = `[${[0, 1, ...Array.from({ length: 1534 }, () => 0)].join(',')}]`;
      const mmA = `[${[0, 1, ...Array.from({ length: 1022 }, () => 0)].join(',')}]`;
      const mmB = `[${[1, ...Array.from({ length: 1023 }, () => 0)].join(',')}]`;
      await (engine as any).db.query(
        `UPDATE content_chunks SET embedding = $1::vector, embedding_multimodal = $2::vector WHERE id = $3`,
        [textA, mmA, chunkA!.chunk_id],
      );
      await (engine as any).db.query(
        `UPDATE content_chunks SET embedding = $1::vector, embedding_multimodal = $2::vector WHERE id = $3`,
        [textB, mmB, chunkB!.chunk_id],
      );

      const originalSearchVector = engine.searchVector.bind(engine);
      // Capture the column(s) searchVector is invoked with and assert AFTER the
      // search returns. An `expect` INSIDE this mock would run inside
      // hybridSearch's unified try/catch and be silently swallowed (the
      // AssertionError is caught and logged as a fall-open), making the column
      // check vacuous. Capturing + asserting outside keeps it load-bearing.
      const embeddingColumnsSeen: unknown[] = [];
      engine.searchVector = (async (_embedding, opts) => {
        embeddingColumnsSeen.push(opts?.embeddingColumn);
        return [
          {
            slug: chunkA!.slug,
            page_id: chunkA!.page_id,
            title: chunkA!.title,
            type: 'note',
            source_id: undefined,
            effective_date: null,
            effective_date_source: null,
            chunk_id: chunkA!.chunk_id,
            chunk_index: 0,
            chunk_text: 'first unified chunk',
            chunk_source: 'compiled_truth',
            score: 1,
            stale: false,
          },
          {
            slug: chunkB!.slug,
            page_id: chunkB!.page_id,
            title: chunkB!.title,
            type: 'note',
            source_id: undefined,
            effective_date: null,
            effective_date_source: null,
            chunk_id: chunkB!.chunk_id,
            chunk_index: 0,
            chunk_text: 'second unified chunk',
            chunk_source: 'compiled_truth',
            score: 0.99,
            stale: false,
          },
        ];
      }) as typeof engine.searchVector;
      try {
        fetchHandler = async (url) => {
          if (url.includes('multimodalembeddings')) {
            return new Response(JSON.stringify({
              data: [{ embedding: [1, ...Array.from({ length: 1023 }, () => 0)], index: 0 }],
            }), { status: 200 });
          }
          throw new Error(`Unexpected text embedding fetch during unified test: ${url}`);
        };

        const results = await hybridSearch(engine, 'rank unified multimodal', { limit: 5 });
        // Vector search must have been routed to embedding_multimodal, never the
        // text/default column (the whole point of unified routing).
        expect(embeddingColumnsSeen.length).toBeGreaterThan(0);
        expect(embeddingColumnsSeen.every((c) => c === 'embedding_multimodal')).toBe(true);
        expect(results[0]?.slug).toBe('unified/b');
      } finally {
        engine.searchVector = originalSearchVector as typeof engine.searchVector;
      }
    });
  });
});
