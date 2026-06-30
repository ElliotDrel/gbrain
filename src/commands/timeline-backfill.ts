/**
 * gbrain timeline-backfill — one-time historical backfill for the two
 * deterministic timeline event sources introduced alongside the
 * timeline_presence_coverage doctor check.
 *
 * Two sub-backfills, both replay-safe via the timeline_entries unique index
 * (page_id, date, summary, source) — re-running is a no-op:
 *
 *   created    — every non-deleted page gets one `system:page-created` event
 *                (date = effective_date ?? created_at). Live emission happens
 *                in putPage() on first insert; this backfills pages that
 *                predate that code. Uses the SAME addTimelineEntriesBatch
 *                write path as live emission, so rows are byte-identical.
 *
 *   citations  — every type='source' page is run through the SAME
 *                extractReferenceCitationTimelineForPage resolver the live
 *                ingest path uses. No fuzzy matching, no separate code path.
 *
 * With no flag, both run. `--created` / `--citations` scope to one. Dedicated
 * runner (not the backfill-registry) because these emit timeline rows onto
 * OTHER pages rather than column-updating the scanned row, which the registry's
 * compute(rows)->{id,updates} contract can't express. Precedent: edges-backfill.
 */
import type { BrainEngine, TimelineBatchInput } from '../core/engine.ts';
import {
  extractReferenceCitationTimelineForPage,
  loadReferenceTargetSet,
  type ReferenceCitationPage,
} from '../core/reference-citation-timeline.ts';
import { buildGazetteer } from '../core/by-mention.ts';

interface TimelineBackfillOpts {
  created?: boolean;
  citations?: boolean;
  dryRun?: boolean;
  json?: boolean;
  batchSize: number;
}

function parseFlags(args: string[]): TimelineBackfillOpts {
  const opts: TimelineBackfillOpts = { batchSize: 500 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--created') opts.created = true;
    else if (a === '--citations') opts.citations = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--batch-size') {
      const n = parseInt(args[++i] ?? '', 10);
      // Guard: 0/NaN/negative all fall back to the default. A negative step
      // would make the write loop never terminate.
      opts.batchSize = Number.isFinite(n) && n > 0 ? n : 500;
    }
  }
  // No scope flag -> run both.
  if (!opts.created && !opts.citations) {
    opts.created = true;
    opts.citations = true;
  }
  return opts;
}

function printHelp(): void {
  process.stderr.write(
    `Usage: gbrain timeline-backfill [--created] [--citations] [--dry-run] [--json]\n\n` +
      `One-time historical backfill for deterministic timeline events. Replay-safe\n` +
      `(idempotent) — re-running inserts nothing new.\n\n` +
      `Flags:\n` +
      `  --created      backfill system:page-created events for every non-deleted page\n` +
      `  --citations    backfill reference-citation events from every type='source' page\n` +
      `  (no flag)      run both\n` +
      `  --dry-run      report what WOULD be written; insert nothing\n` +
      `  --batch-size N created-event insert batch size (default 500)\n` +
      `  --json         emit JSON result on stdout\n`,
  );
}

function isoDate(value: string | Date | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

async function backfillCreated(
  engine: BrainEngine,
  opts: TimelineBackfillOpts,
): Promise<{ pages_scanned: number; events_written: number; skipped_no_date: number }> {
  const rows = await engine.executeRaw<{
    slug: string;
    source_id: string | null;
    effective_date: string | null;
    created_at: string | null;
  }>(
    `SELECT slug, source_id, effective_date, created_at
       FROM pages
      WHERE deleted_at IS NULL`,
    [],
  );

  let skippedNoDate = 0;
  const batch: TimelineBatchInput[] = [];
  for (const r of rows) {
    // Mirror putPage(): effective_date ?? created_at.
    const date = isoDate(r.effective_date) ?? isoDate(r.created_at);
    if (!date) {
      skippedNoDate++;
      continue;
    }
    batch.push({
      slug: r.slug,
      source_id: r.source_id ?? 'default',
      date,
      source: 'system:page-created',
      summary: 'Created',
      detail: '',
    });
  }

  if (opts.dryRun) {
    return { pages_scanned: rows.length, events_written: batch.length, skipped_no_date: skippedNoDate };
  }

  let written = 0;
  for (let i = 0; i < batch.length; i += opts.batchSize) {
    const slice = batch.slice(i, i + opts.batchSize);
    written += await engine.addTimelineEntriesBatch(slice, { auditSite: 'timeline-backfill.created' });
  }
  return { pages_scanned: rows.length, events_written: written, skipped_no_date: skippedNoDate };
}

async function backfillCitations(
  engine: BrainEngine,
  opts: TimelineBackfillOpts,
): Promise<{ source_pages_scanned: number; events_written: number; targets_matched: number }> {
  const rows = await engine.executeRaw<ReferenceCitationPage>(
    `SELECT slug, source_id, title, type, compiled_truth, timeline, effective_date, created_at
       FROM pages
      WHERE deleted_at IS NULL
        AND type = 'source'`,
    [],
  );

  // Build the gazetteer AND the reference-target set once, then reuse across
  // every source page — the resolver accepts both as injected inputs, so we
  // avoid rebuilding the gazetteer and re-querying the target set per page.
  const gazetteer = await buildGazetteer(engine);
  const referenceTargets = await loadReferenceTargetSet(engine);

  let eventsWritten = 0;
  let targetsMatched = 0;
  for (const page of rows) {
    const result = await extractReferenceCitationTimelineForPage(engine, page, {
      gazetteer,
      referenceTargets,
      dryRun: opts.dryRun,
    });
    eventsWritten += result.entries_created;
    targetsMatched += result.targets_matched;
  }
  return { source_pages_scanned: rows.length, events_written: eventsWritten, targets_matched: targetsMatched };
}

export async function runTimelineBackfill(engine: BrainEngine, args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }
  const opts = parseFlags(args);
  const out: Record<string, unknown> = { schema_version: 1, dry_run: !!opts.dryRun };

  if (opts.created) {
    if (!opts.json) process.stderr.write(`[timeline-backfill] created: scanning pages...\n`);
    const r = await backfillCreated(engine, opts);
    out.created = r;
    if (!opts.json) {
      process.stderr.write(
        `[timeline-backfill] created: ${r.pages_scanned} pages scanned, ` +
          `${r.events_written} events ${opts.dryRun ? 'candidate (idempotent run inserts only missing rows)' : 'inserted'}` +
          `${r.skipped_no_date ? `, ${r.skipped_no_date} skipped (no date)` : ''}\n`,
      );
    }
  }

  if (opts.citations) {
    if (!opts.json) process.stderr.write(`[timeline-backfill] citations: scanning source pages...\n`);
    const r = await backfillCitations(engine, opts);
    out.citations = r;
    if (!opts.json) {
      process.stderr.write(
        `[timeline-backfill] citations: ${r.source_pages_scanned} source pages scanned, ` +
          `${r.events_written} events ${opts.dryRun ? 'candidate (idempotent run inserts only missing rows)' : 'inserted'} ` +
          `(${r.targets_matched} targets matched)\n`,
      );
    }
  }

  if (opts.json) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}
