import type { BrainEngine, TimelineBatchInput } from './engine.ts';
import { buildGazetteer, findMentionedEntities, type Gazetteer } from './by-mention.ts';

export interface ReferenceCitationPage {
  slug: string;
  source_id: string;
  title: string;
  type: string;
  compiled_truth: string;
  timeline: string;
  effective_date?: Date | string | null;
  created_at?: Date | string | null;
}

export interface ReferenceCitationOpts {
  dryRun?: boolean;
  gazetteer?: Gazetteer;
  sourceKeyPrefix?: string;
}

export interface ReferenceCitationResult {
  entries_created: number;
  targets_matched: number;
  skipped_reason?: 'non_source_page' | 'missing_date' | 'no_matches';
}

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

async function loadReferenceTargetSet(engine: BrainEngine): Promise<Set<string>> {
  const rows = await engine.executeRaw<{ slug: string; source_id: string | null }>(
    `SELECT slug, source_id
       FROM pages
      WHERE deleted_at IS NULL
        AND frontmatter->>'reference' = 'true'`,
    [],
  );
  return new Set(rows.map((r) => `${r.source_id ?? 'default'}::${r.slug}`));
}

export async function extractReferenceCitationTimelineForPage(
  engine: BrainEngine,
  page: ReferenceCitationPage,
  opts: ReferenceCitationOpts = {},
): Promise<ReferenceCitationResult> {
  if (page.type !== 'source') {
    return { entries_created: 0, targets_matched: 0, skipped_reason: 'non_source_page' };
  }

  const date = isoDate(page.effective_date) ?? isoDate(page.created_at);
  if (!date) {
    return { entries_created: 0, targets_matched: 0, skipped_reason: 'missing_date' };
  }

  const gazetteer = opts.gazetteer ?? await buildGazetteer(engine);
  const referenceTargets = await loadReferenceTargetSet(engine);
  const mentions = findMentionedEntities(
    `${page.compiled_truth}\n${page.timeline}`.trim(),
    gazetteer,
    { fromSlug: page.slug, fromSourceId: page.source_id },
  );

  const batch: TimelineBatchInput[] = mentions
    .filter((m) => referenceTargets.has(`${m.source_id}::${m.slug}`))
    .map((m) => ({
      slug: m.slug,
      source_id: m.source_id,
      date,
      source: `${opts.sourceKeyPrefix ?? 'reference-citation'}:${page.source_id}::${page.slug}`,
      summary: `Referenced in ${page.slug}`,
    }));

  if (batch.length === 0) {
    return { entries_created: 0, targets_matched: 0, skipped_reason: 'no_matches' };
  }

  if (opts.dryRun) {
    return { entries_created: batch.length, targets_matched: batch.length };
  }

  const entriesCreated = await engine.addTimelineEntriesBatch(batch, {
    auditSite: 'extract.timeline_db',
  });
  return { entries_created: entriesCreated, targets_matched: batch.length };
}
