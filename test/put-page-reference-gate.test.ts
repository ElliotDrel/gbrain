import { describe, test, expect } from 'bun:test';
import { operations, OperationError } from '../src/core/operations.ts';
import type { OperationContext } from '../src/core/operations.ts';
import type { BrainEngine } from '../src/core/engine.ts';

const putPage = operations.find((o) => o.name === 'put_page');
if (!putPage) throw new Error('put_page op missing');

function makeCtx(engine: BrainEngine, overrides: Partial<OperationContext> = {}): OperationContext {
  return {
    engine,
    config: { engine: 'postgres' } as any,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    dryRun: true,
    remote: true,
    sourceId: 'default',
    ...overrides,
  };
}

function makeEngine(existing: boolean): BrainEngine {
  return {
    getPage: async () => (existing ? ({ slug: 'people/existing' } as any) : null),
  } as BrainEngine;
}

describe('put_page reference gate', () => {
  test('remote creation of new people page requires entity_relationship', async () => {
    const ctx = makeCtx(makeEngine(false));
    await expect(
      putPage.handler(ctx, {
        slug: 'people/andy-grove',
        content: '---\ntitle: Andy Grove\ntype: person\n---\n\nbody',
      }),
    ).rejects.toMatchObject({
      code: 'invalid_params',
      docs: 'skills/conventions/reference-entities.md',
    });
  });

  test('remote creation of new company page does not require entity_relationship', async () => {
    const ctx = makeCtx(makeEngine(false));
    const result = await putPage.handler(ctx, {
      slug: 'companies/openai',
      content: '---\ntitle: OpenAI\ntype: company\n---\n\nbody',
    });
    expect(result).toMatchObject({ dry_run: true, action: 'put_page', slug: 'companies/openai' });
  });

  test('companies cannot carry reference: true', async () => {
    const ctx = makeCtx(makeEngine(false));
    await expect(
      putPage.handler(ctx, {
        slug: 'companies/openai',
        content: '---\ntitle: OpenAI\ntype: company\nreference: true\n---\n\nbody',
      }),
    ).rejects.toMatchObject({
      code: 'invalid_params',
      docs: 'skills/conventions/reference-entities.md',
    });
  });

  test('companies reject entity_relationship entirely', async () => {
    const ctx = makeCtx(makeEngine(false));
    await expect(
      putPage.handler(ctx, {
        slug: 'companies/openai',
        content: '---\ntitle: OpenAI\ntype: company\n---\n\nbody',
        entity_relationship: 'real',
      }),
    ).rejects.toMatchObject({
      code: 'invalid_params',
      docs: 'skills/conventions/reference-entities.md',
    });
  });

  test('existing remote entity page update does not require entity_relationship', async () => {
    const ctx = makeCtx(makeEngine(true));
    const result = await putPage.handler(ctx, {
      slug: 'people/existing',
      content: '---\ntitle: Existing\ntype: person\n---\n\nbody',
    });
    expect(result).toMatchObject({ dry_run: true, action: 'put_page', slug: 'people/existing' });
  });

  test('local callers are not gated', async () => {
    const ctx = makeCtx(makeEngine(false), { remote: false });
    const result = await putPage.handler(ctx, {
      slug: 'people/local-person',
      content: '---\ntitle: Local Person\ntype: person\n---\n\nbody',
    });
    expect(result).toMatchObject({ dry_run: true, action: 'put_page', slug: 'people/local-person' });
  });

  test('entity_relationship=real conflicts with reference: true', async () => {
    const ctx = makeCtx(makeEngine(false));
    await expect(
      putPage.handler(ctx, {
        slug: 'people/conflict',
        content: '---\ntitle: Conflict\ntype: person\nreference: true\n---\n\nbody',
        entity_relationship: 'real',
      }),
    ).rejects.toBeInstanceOf(OperationError);
  });

  test('reference person with interaction signals is rejected', async () => {
    const ctx = makeCtx(makeEngine(false));
    await expect(
      putPage.handler(ctx, {
        slug: 'people/conflict',
        content: '---\ntitle: Conflict\ntype: person\nreference: true\n---\n\n## Timeline\n- 2026-06-17 -- Meeting with Elliot',
        entity_relationship: 'reference',
      }),
    ).rejects.toMatchObject({
      code: 'invalid_params',
      docs: 'skills/conventions/reference-entities.md',
    });
  });
});
