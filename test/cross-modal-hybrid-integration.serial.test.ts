// Phase 1 integration test — hybridSearch cross-modal routing.
//
// Uses real PGLite + stubbed gateway fetch. Verifies the routing decisions
// from query-intent through hybrid.ts to engine.searchVector with the
// correct embeddingColumn.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { resetPgliteState } from './helpers/reset-pglite.ts';
import { withEnv } from './helpers/with-env.ts';
import {
  configureGateway,
  resetGateway,
} from '../src/core/ai/gateway.ts';
import { hybridSearch, hybridSearchCached } from '../src/core/search/hybrid.ts';

let engine: PGLiteEngine;

type FetchHandler = (url: string, init: RequestInit) => Promise<Response>;
let fetchHandler: FetchHandler | null = null;
const origFetch = globalThis.fetch;
let fetchUrlsSeen: string[] = [];
let fetchBodiesSeen: any[] = [];
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
  fetchHandler = null;
  fetchUrlsSeen = [];
  fetchBodiesSeen = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    fetchUrlsSeen.push(u);
    if (init?.body) {
      try { fetchBodiesSeen.push(JSON.parse(init.body as string)); } catch { /* ignore */ }
    }
    if (!fetchHandler) {
      // Return a generic 1024-dim Voyage-shape response by default
      return new Response(JSON.stringify({
        data: [{ embedding: Array.from({ length: 1024 }, () => 0.1), index: 0 }],
        model: 'voyage-multimodal-3',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return fetchHandler(u, init ?? {});
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = origFetch;
  resetGateway();
});

function configureBoth() {
  // Gateway needs BOTH text and multimodal models configured. Use a single
  // openai recipe stub for text — we won't hit it for image-only queries.
  configureGateway({
    embedding_model: 'openai:text-embedding-3-large',
    embedding_dimensions: 1536,
    embedding_multimodal_model: 'voyage:voyage-multimodal-3',
    env: {
      OPENAI_API_KEY: 'test-key',
      VOYAGE_API_KEY: 'voyage-test-key',
    },
  });
}

describe('hybridSearch cross-modal routing (Phase 1 integration)', () => {
  test("explicit crossModal: 'image' calls Voyage multimodal endpoint, NOT OpenAI", async () => {
    await withEnv(TEXT_EMBED_ENV, async () => {
      configureBoth();
      const originalSearchVector = engine.searchVector.bind(engine);
      const embeddingColumnsSeen: string[] = [];
      engine.searchVector = (async (embedding, opts) => {
        embeddingColumnsSeen.push(captureEmbeddingColumnName(opts));
        return originalSearchVector(embedding, opts);
      }) as typeof engine.searchVector;
      try {
        fetchHandler = async (url) => {
          if (url.includes('multimodalembeddings')) {
            return new Response(JSON.stringify({
              data: [{ embedding: Array.from({ length: 1024 }, () => 0.5), index: 0 }],
              model: 'voyage-multimodal-3',
            }), { status: 200 });
          }
          throw new Error(`Unexpected fetch to OpenAI: ${url}`);
        };

        const results = await hybridSearch(engine, 'hackathon stuff', { crossModal: 'image', limit: 5 });
        expect(Array.isArray(results)).toBe(true);
        expect(fetchUrlsSeen.some(u => u.includes('multimodalembeddings'))).toBe(true);
        expect(fetchUrlsSeen.some(u => u.includes('api.openai.com') && u.includes('embeddings'))).toBe(false);
        expect(embeddingColumnsSeen).toEqual(['embedding_image']);
      } finally {
        engine.searchVector = originalSearchVector as typeof engine.searchVector;
      }
    });
  });

  test('explicit crossModal: "image" threads inputType=query in Voyage body (D22-2)', async () => {
    await withEnv(TEXT_EMBED_ENV, async () => {
      configureBoth();
      fetchHandler = async (url) => {
        if (url.includes('multimodalembeddings')) {
          return new Response(JSON.stringify({
            data: [{ embedding: Array.from({ length: 1024 }, () => 0.5), index: 0 }],
            model: 'voyage-multimodal-3',
          }), { status: 200 });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      };

      await hybridSearch(engine, 'any text', { crossModal: 'image', limit: 5 });
      const voyageBody = fetchBodiesSeen.find(b => b?.inputs?.[0]?.content?.[0]?.type === 'text');
      expect(voyageBody).toBeDefined();
      expect(voyageBody.input_type).toBe('query');
    });
  });

  test('default crossModal=text query does NOT call Voyage multimodal', async () => {
    await withEnv(TEXT_EMBED_ENV, async () => {
      configureBoth();
      fetchHandler = async (url) => {
        if (url.includes('multimodalembeddings')) {
          throw new Error('Unexpected multimodal call for text-modality query');
        }
        return new Response(JSON.stringify({
          data: [{ embedding: Array.from({ length: 1536 }, () => 0.1), index: 0 }],
          model: 'text-embedding-3-large',
        }), { status: 200 });
      };

      await hybridSearch(engine, 'what is founder mode', { limit: 5 });
      expect(fetchUrlsSeen.some(u => u.includes('multimodalembeddings'))).toBe(false);
    });
  });

  test("'auto' literal normalizes to undefined (D22-1) — text query still routes text", async () => {
    await withEnv(TEXT_EMBED_ENV, async () => {
      configureBoth();
      fetchHandler = async (url) => {
        if (url.includes('multimodalembeddings')) {
          throw new Error('Unexpected multimodal call for auto-text-intent query');
        }
        return new Response(JSON.stringify({
          data: [{ embedding: Array.from({ length: 1536 }, () => 0.1), index: 0 }],
          model: 'text-embedding-3-large',
        }), { status: 200 });
      };

      await hybridSearch(engine, 'what is founder mode', { crossModal: 'auto', limit: 5 });
      expect(fetchUrlsSeen.some(u => u.includes('multimodalembeddings'))).toBe(false);
    });
  });

  test('"show me photos from the hackathon" auto-detects to image routing', async () => {
    await withEnv(TEXT_EMBED_ENV, async () => {
      configureBoth();
      fetchHandler = async (url) => {
        if (url.includes('multimodalembeddings')) {
          return new Response(JSON.stringify({
            data: [{ embedding: Array.from({ length: 1024 }, () => 0.3), index: 0 }],
            model: 'voyage-multimodal-3',
          }), { status: 200 });
        }
        return new Response(JSON.stringify({
          data: [{ embedding: Array.from({ length: 1536 }, () => 0.1), index: 0 }],
          model: 'text-embedding-3-large',
        }), { status: 200 });
      };

      await hybridSearch(engine, 'show me photos from the hackathon', { limit: 5 });
      expect(fetchUrlsSeen.some(u => u.includes('multimodalembeddings'))).toBe(true);
    });
  });

  test("'both' mode hits BOTH endpoints in parallel", async () => {
    await withEnv(TEXT_EMBED_ENV, async () => {
      configureBoth();
      const originalSearchVector = engine.searchVector.bind(engine);
      const embeddingColumnsSeen: string[] = [];
      let textCalled = 0;
      let voyageCalled = 0;
      engine.searchVector = (async (embedding, opts) => {
        embeddingColumnsSeen.push(captureEmbeddingColumnName(opts));
        return originalSearchVector(embedding, opts);
      }) as typeof engine.searchVector;
      try {
        fetchHandler = async (url) => {
          if (url.includes('multimodalembeddings')) {
            voyageCalled++;
            return new Response(JSON.stringify({
              data: [{ embedding: Array.from({ length: 1024 }, () => 0.3), index: 0 }],
              model: 'voyage-multimodal-3',
            }), { status: 200 });
          }
          textCalled++;
          return new Response(JSON.stringify({
            data: [{ embedding: Array.from({ length: 1536 }, () => 0.1), index: 0 }],
            model: 'text-embedding-3-large',
          }), { status: 200 });
        };

        await hybridSearch(engine, 'anything', { crossModal: 'both', limit: 5 });
        expect(textCalled).toBeGreaterThanOrEqual(1);
        expect(voyageCalled).toBeGreaterThanOrEqual(1);
        expect(embeddingColumnsSeen).toContain('embedding');
        expect(embeddingColumnsSeen).toContain('embedding_image');
      } finally {
        engine.searchVector = originalSearchVector as typeof engine.searchVector;
      }
    });
  });

  test('fail-open: multimodal unconfigured → image-intent query falls back to text', async () => {
    await withEnv(TEXT_EMBED_ENV, async () => {
      configureGateway({
        embedding_model: 'openai:text-embedding-3-large',
        embedding_dimensions: 1536,
        env: { OPENAI_API_KEY: 'test-key' },
      });
      fetchHandler = async (url) => {
        if (url.includes('multimodalembeddings')) {
          throw new Error('Voyage should not be called when not configured');
        }
        return new Response(JSON.stringify({
          data: [{ embedding: Array.from({ length: 1536 }, () => 0.1), index: 0 }],
          model: 'text-embedding-3-large',
        }), { status: 200 });
      };

      const results = await hybridSearch(engine, 'show me photos', { crossModal: 'image', limit: 5 });
      expect(Array.isArray(results)).toBe(true);
    });
  });

  test('image routing works with multimodal-only provider config', async () => {
    configureGateway({
      embedding_multimodal_model: 'voyage:voyage-multimodal-3',
      env: { VOYAGE_API_KEY: 'voyage-test-key' },
    });
    const originalSearchVector = engine.searchVector.bind(engine);
    const embeddingColumnsSeen: string[] = [];
    engine.searchVector = (async (embedding, opts) => {
      embeddingColumnsSeen.push(captureEmbeddingColumnName(opts));
      return originalSearchVector(embedding, opts);
    }) as typeof engine.searchVector;
    try {
      fetchHandler = async (url) => {
        if (url.includes('multimodalembeddings')) {
          return new Response(JSON.stringify({
            data: [{ embedding: Array.from({ length: 1024 }, () => 0.2), index: 0 }],
            model: 'voyage-multimodal-3',
          }), { status: 200 });
        }
        throw new Error(`Unexpected text embedding fetch: ${url}`);
      };

      const results = await hybridSearch(engine, 'show me photos from demo day', { crossModal: 'image', limit: 5 });
      expect(Array.isArray(results)).toBe(true);
      expect(fetchUrlsSeen.some((u) => u.includes('multimodalembeddings'))).toBe(true);
      expect(embeddingColumnsSeen).toEqual(['embedding_image']);
    } finally {
      engine.searchVector = originalSearchVector as typeof engine.searchVector;
    }
  });

  test('hybridSearchCached disables cache for multimodal requests', async () => {
    await withEnv(TEXT_EMBED_ENV, async () => {
      configureBoth();
      let meta: { cache?: { status?: string } } | undefined;
      fetchHandler = async (url) => {
        if (url.includes('multimodalembeddings')) {
          return new Response(JSON.stringify({
            data: [{ embedding: Array.from({ length: 1024 }, () => 0.4), index: 0 }],
            model: 'voyage-multimodal-3',
          }), { status: 200 });
        }
        return new Response(JSON.stringify({
          data: [{ embedding: Array.from({ length: 1536 }, () => 0.1), index: 0 }],
          model: 'text-embedding-3-large',
        }), { status: 200 });
      };

      await hybridSearchCached(engine, 'show me photos from the hackathon', {
        crossModal: 'image',
        limit: 5,
        onMeta: (m) => { meta = m; },
      });
      expect(meta?.cache?.status).toBe('disabled');
    });
  });
});
