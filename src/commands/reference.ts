// gbrain reference <people/slug> [--unset] [--brain <dir>] [--json]
// gbrain reference audit [--brain <dir>] [--json]
//
// `reference: true` is a PEOPLE-only flag. It keeps a person page fully
// searchable/enrichable/linkable while exempting it from relationship-history
// coverage metrics. Companies are never reference.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, posix as pathPosix, resolve } from 'node:path';
import type { BrainEngine } from '../core/engine.ts';
import { walkBrainRepo } from '../core/disk-walk.ts';
import { setCliExitVerdict } from '../core/cli-force-exit.ts';
import { REFERENCE_FRONTMATTER_KEY } from '../core/reference-flag.ts';

const INTERACTION_PREFIXES = [
  'meetings/',
  'deals/',
  'projects/',
  'personal/',
  'org/',
  'hiring/',
  'programs/',
  'civic/',
  'household/',
] as const;

const CONTENT_PREFIXES = [
  'concepts/',
  'sources/',
  'media/',
  'ideas/',
  'writing/',
] as const;

const INTERACTION_TIMELINE_RE =
  /^\s*-\s*\d{4}-\d{2}-\d{2}.*\b(Meeting with|Call with|Email from|Email to|Intro to|Introduced to|Met with|Met at|Coffee with|Lunch with|Dinner with|Text from|DM from)\b/im;
const INTERACTION_FIELD_RE =
  /^(email|phone|mobile|contact|introduced_by|intro_source|met_at|met_on|last_met|follow_up):/im;
const DIRECT_INTERACTION_LINE_RE =
  /(Attendees?:|Meeting with|Call with|Email from|Email to|Introduced|Intro to|Met with|Met at|Coffee with|Lunch with|Dinner with|Text from|DM from)/i;

export interface ReferenceAuditIssue {
  severity: 'error' | 'warn';
  code:
    | 'illegal_reference_on_non_person'
    | 'reference_person_has_interaction'
    | 'likely_missing_person_reference';
  slug: string;
  message: string;
  evidence: string[];
}

export interface ReferenceAuditReport {
  ok: boolean;
  scanned: {
    total_pages: number;
    people: number;
    reference_people: number;
  };
  errors: number;
  warnings: number;
  issues: ReferenceAuditIssue[];
}

interface ParsedArgs {
  subcommand: 'mark' | 'audit';
  slug?: string;
  unset: boolean;
  json: boolean;
  brain?: string;
}

interface AuditPage {
  slug: string;
  content: string;
}

/** Insert/replace/remove `reference: true` in a markdown frontmatter block.
 *  Minimal-diff: only the one line changes; key order is otherwise preserved. */
export function applyReferenceFrontmatter(content: string, on: boolean): string {
  const keyLine = `${REFERENCE_FRONTMATTER_KEY}: true`;
  const block = content.match(/^---\n([\s\S]*?)\n---/);

  if (!block) {
    if (!on) return content;
    return `---\n${keyLine}\n---\n\n${content}`;
  }

  let fm = block[1];
  const hasKey = new RegExp(`^${REFERENCE_FRONTMATTER_KEY}:.*$`, 'm').test(fm);

  if (on) {
    fm = hasKey
      ? fm.replace(new RegExp(`^${REFERENCE_FRONTMATTER_KEY}:.*$`, 'm'), keyLine)
      : `${fm}\n${keyLine}`;
  } else {
    if (!hasKey) return content;
    fm = fm.replace(new RegExp(`^${REFERENCE_FRONTMATTER_KEY}:.*$\\n?`, 'm'), '');
  }

  return content.replace(/^---\n[\s\S]*?\n---/, () => `---\n${fm}\n---`);
}

function parseArgs(args: string[]): ParsedArgs {
  let subcommand: 'mark' | 'audit' = 'mark';
  let slug: string | undefined;
  let unset = false;
  let json = false;
  let brain: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === 'audit' && !slug) subcommand = 'audit';
    else if (a === '--unset') unset = true;
    else if (a === '--json') json = true;
    else if (a === '--brain' || a === '--dir') brain = args[++i];
    else if (!a.startsWith('--') && !slug) slug = a;
  }
  return { subcommand, slug, unset, json, brain };
}

async function resolveBrainDir(engine: BrainEngine, explicit?: string): Promise<string | null> {
  if (explicit) return resolve(explicit);
  const configured = await engine.getConfig('sync.repo_path');
  if (configured && existsSync(configured)) return resolve(configured);
  return null;
}

function isPersonSlug(slug: string): boolean {
  return slug.startsWith('people/');
}

function isCompanySlug(slug: string): boolean {
  return slug.startsWith('companies/');
}

function hasReferenceFlag(content: string): boolean {
  return /^---\n[\s\S]*?^reference:\s*true\s*$/m.test(content);
}

function classifySourceSurface(slug: string): 'interaction' | 'content' | 'other' {
  if (INTERACTION_PREFIXES.some((p) => slug.startsWith(p))) return 'interaction';
  if (CONTENT_PREFIXES.some((p) => slug.startsWith(p)) || slug.includes('.raw/')) return 'content';
  return 'other';
}

function detectInteractionSignals(content: string): string[] {
  const hits: string[] = [];
  if (INTERACTION_TIMELINE_RE.test(content)) hits.push('page timeline contains meeting/email/call-style interaction entries');
  if (INTERACTION_FIELD_RE.test(content)) hits.push('page frontmatter/body contains direct-contact fields');
  return hits;
}

function hasDirectInteractionBacklink(sourceSlug: string, sourceContent: string, targetSlug: string): boolean {
  if (classifySourceSurface(sourceSlug) !== 'interaction') return false;
  for (const line of sourceContent.split(/\r?\n/)) {
    if (!DIRECT_INTERACTION_LINE_RE.test(line)) continue;
    if (extractLinkedSlugs(line, sourceSlug).includes(targetSlug)) return true;
  }
  return false;
}

function normalizeLinkTarget(rawTarget: string, fromSlug: string): string | null {
  let target = rawTarget.trim();
  if (!target || target.startsWith('#')) return null;
  if (target.includes('://') || target.startsWith('mailto:')) return null;
  target = target.split('#')[0]?.split('?')[0] ?? '';
  if (!target) return null;
  if (target.startsWith('/')) target = target.slice(1);
  const baseDir = dirname(fromSlug);
  const normalized = target.startsWith('./') || target.startsWith('../')
    ? pathPosix.normalize(pathPosix.join(baseDir, target))
    : pathPosix.normalize(target);
  if (!normalized || normalized.startsWith('../')) return null;
  return normalized.endsWith('.md') ? normalized.slice(0, -3) : normalized;
}

export function extractLinkedSlugs(content: string, fromSlug: string): string[] {
  const out = new Set<string>();
  const linkRe = /\[[^\]]*?\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(content)) !== null) {
    const slug = normalizeLinkTarget(m[1] ?? '', fromSlug);
    if (!slug) continue;
    out.add(slug);
  }
  return [...out].sort();
}

export function buildReferenceAuditReport(pages: AuditPage[]): ReferenceAuditReport {
  const sortedPages = [...pages].sort((a, b) => a.slug.localeCompare(b.slug));
  const contentBySlug = new Map(sortedPages.map((p) => [p.slug, p.content]));
  const backlinks = new Map<string, Set<string>>();

  for (const page of sortedPages) {
    const targets = extractLinkedSlugs(page.content, page.slug);
    for (const target of targets) {
      if (!isPersonSlug(target) && !isCompanySlug(target)) continue;
      if (!contentBySlug.has(target)) continue;
      let set = backlinks.get(target);
      if (!set) {
        set = new Set<string>();
        backlinks.set(target, set);
      }
      set.add(page.slug);
    }
  }

  const issues: ReferenceAuditIssue[] = [];
  let people = 0;
  let referencePeople = 0;

  for (const page of sortedPages) {
    const isPerson = isPersonSlug(page.slug);

    if (isPerson) people++;

    const isReference = hasReferenceFlag(page.content);

    // reference is a people-only flag. ANY non-person page carrying a reference
    // indicator (companies, concepts, sources, media, ...) is a violation — flag
    // it by name. We don't track a "reference companies" count at all; the
    // concept doesn't exist for non-people.
    if (!isPerson && isReference) {
      issues.push({
        severity: 'error',
        code: 'illegal_reference_on_non_person',
        slug: page.slug,
        message: 'reference is a people-only flag; this non-person page carries reference: true',
        evidence: ['frontmatter contains reference: true'],
      });
      continue;
    }

    // Everything below is people-only relationship logic.
    if (!isPerson) continue;

    if (isReference) referencePeople++;

    const sources = [...(backlinks.get(page.slug) ?? new Set<string>())].sort();
    const interactionSources = sources.filter((s) => {
      const sourceContent = contentBySlug.get(s);
      return sourceContent ? hasDirectInteractionBacklink(s, sourceContent, page.slug) : false;
    });
    const contentSources = sources.filter((s) => classifySourceSurface(s) === 'content');
    const interactionSignals = detectInteractionSignals(page.content);

    if (isReference && (interactionSources.length > 0 || interactionSignals.length > 0)) {
      issues.push({
        severity: 'error',
        code: 'reference_person_has_interaction',
        slug: page.slug,
        message: 'reference person has direct interaction evidence and should be real',
        evidence: [...interactionSources, ...interactionSignals].sort(),
      });
      continue;
    }

    if (!isReference && interactionSources.length === 0 && contentSources.length > 0) {
      issues.push({
        severity: 'warn',
        code: 'likely_missing_person_reference',
        slug: page.slug,
        message: 'person looks content-only and is a likely missed reference',
        evidence: contentSources,
      });
    }
  }

  issues.sort((a, b) => {
    const sev = a.severity.localeCompare(b.severity);
    return sev !== 0 ? sev : a.slug.localeCompare(b.slug);
  });

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;
  return {
    ok: errors === 0,
    scanned: {
      total_pages: sortedPages.length,
      people,
      reference_people: referencePeople,
    },
    errors,
    warnings,
    issues,
  };
}

export function loadAuditPages(brainDir: string): AuditPage[] {
  const pages: AuditPage[] = [];
  for (const slug of walkBrainRepo(brainDir).keys()) {
    const filePath = join(brainDir, `${slug}.md`);
    pages.push({ slug, content: readFileSync(filePath, 'utf8') });
  }
  return pages;
}

function printAuditReport(report: ReferenceAuditReport): void {
  const headline = report.errors > 0 ? 'FAIL' : report.warnings > 0 ? 'WARN' : 'OK';
  console.log(
    `Reference audit ${headline} — ${report.scanned.total_pages} pages, ${report.scanned.people} people, ` +
    `${report.scanned.reference_people} reference people`,
  );
  if (report.issues.length === 0) {
    console.log('No reference drift found.');
    return;
  }
  for (const issue of report.issues) {
    console.log(`\n[${issue.severity.toUpperCase()}] ${issue.slug}`);
    console.log(`  ${issue.message}`);
    for (const ev of issue.evidence) console.log(`  - ${ev}`);
  }
}

async function runReferenceMark(engine: BrainEngine, args: ParsedArgs): Promise<void> {
  const { slug, unset, json, brain } = args;
  if (!slug) {
    console.error('Usage: gbrain reference <people/slug> [--unset] [--brain <dir>] [--json]');
    setCliExitVerdict(2);
    return;
  }
  if (!isPersonSlug(slug) && !unset) {
    console.error('reference: the reference flag applies only to people/ pages. Companies are never reference.');
    setCliExitVerdict(1);
    return;
  }

  const brainDir = await resolveBrainDir(engine, brain);
  if (!brainDir) {
    console.error('reference: could not resolve brain dir. Pass --brain <dir> or set sync.repo_path.');
    setCliExitVerdict(1);
    return;
  }

  const rel = slug.endsWith('.md') ? slug : `${slug}.md`;
  const filePath = isAbsolute(rel) ? rel : join(brainDir, rel);
  if (!existsSync(filePath)) {
    console.error(`reference: page not found on disk: ${filePath}`);
    setCliExitVerdict(1);
    return;
  }

  const cleanSlug = slug.replace(/\.md$/, '');
  if (isCompanySlug(cleanSlug) && !unset) {
    console.error('reference: companies cannot be marked reference. Remove the flag instead.');
    setCliExitVerdict(1);
    return;
  }

  const before = readFileSync(filePath, 'utf8');
  const after = applyReferenceFrontmatter(before, !unset);
  const fileChanged = after !== before;
  if (fileChanged) writeFileSync(filePath, after, 'utf8');

  if (unset) {
    await engine.executeRaw(
      `UPDATE pages SET frontmatter = frontmatter - '${REFERENCE_FRONTMATTER_KEY}' WHERE slug = $1`,
      [cleanSlug],
    );
  } else {
    await engine.executeRaw(
      `UPDATE pages SET frontmatter = jsonb_set(COALESCE(frontmatter, '{}'::jsonb), '{${REFERENCE_FRONTMATTER_KEY}}', 'true'::jsonb) WHERE slug = $1`,
      [cleanSlug],
    );
  }

  const result = { slug: cleanSlug, reference: !unset, file_changed: fileChanged, file: filePath };
  if (json) {
    console.log(JSON.stringify(result));
  } else {
    const verb = unset ? 'unmarked' : 'marked';
    console.log(`${verb} ${cleanSlug} as reference=${!unset}${fileChanged ? '' : ' (frontmatter already current)'}`);
    console.log('  -> people-only flag; exempt from timeline_coverage / entity_link_coverage.');
  }
}

async function runReferenceAudit(engine: BrainEngine, args: ParsedArgs): Promise<void> {
  const brainDir = await resolveBrainDir(engine, args.brain);
  if (!brainDir) {
    console.error('reference audit: could not resolve brain dir. Pass --brain <dir> or set sync.repo_path.');
    setCliExitVerdict(1);
    return;
  }

  const report = buildReferenceAuditReport(loadAuditPages(brainDir));
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printAuditReport(report);
  setCliExitVerdict(report.errors > 0 ? 1 : 0);
}

export async function runReference(engine: BrainEngine, argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.subcommand === 'audit') {
    await runReferenceAudit(engine, args);
    return;
  }
  await runReferenceMark(engine, args);
}
