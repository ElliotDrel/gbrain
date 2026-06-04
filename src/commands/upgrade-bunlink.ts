import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

export interface ConflictRecord {
  file: string;
  commit: string;       // patch commit SHA whose replay conflicted
  subject: string;      // its one-line subject
  backupPath: string | null; // pre-upgrade (patched) copy; null if no pre-upgrade version existed
}

export interface BunLinkUpgradeResult {
  status: 'current' | 'upgraded' | 'upgraded_with_conflicts' | 'dirty' | 'no_upstream' | 'failed';
  upstream?: string;    // e.g. 'origin/master'
  pulled?: number;      // upstream commits applied
  replayed?: number;    // local patch commits that survived the rebase
  conflicts?: ConflictRecord[];
  backupRef?: string;   // instant-rollback branch, e.g. 'backup/pre-upgrade-<id>'
  backupDir?: string;   // where patched versions of conflicted files were saved
  error?: string;
}

function git(repoRoot: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf-8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_EDITOR: 'true' },
  }).trim();
}

function rebaseInProgress(repoRoot: string): boolean {
  return existsSync(join(repoRoot, '.git', 'rebase-merge'))
    || existsSync(join(repoRoot, '.git', 'rebase-apply'));
}

function timestampId(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Rebase-aware upgrade for bun-link source clones (replaces `git pull --ff-only`).
 *
 * Local patch commits ride on top of the configured upstream. Clean patches
 * replay automatically. Where upstream touched the same lines, UPSTREAM WINS
 * by default: the patched version of each conflicted file is backed up to
 * `<backupBase>/<id>/<path>` first, then the upstream side is taken and the
 * rebase finishes. The repo is never left mid-rebase. A backup branch
 * `backup/pre-upgrade-<id>` is always created as the instant-rollback point.
 *
 * Re-applying backed-up patches is a separate, user-approved step:
 * skills/upgrade-resolve/SKILL.md.
 */
export function runBunLinkUpgrade(
  repoRoot: string,
  opts: { id?: string; backupBase?: string } = {},
): BunLinkUpgradeResult {
  // Same remote semantics as the old `git pull`: the branch's configured upstream.
  let upstream: string;
  try {
    upstream = git(repoRoot, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}');
  } catch {
    return {
      status: 'no_upstream',
      error: 'Current branch has no upstream tracking branch. Set one with: git branch --set-upstream-to=<remote>/<branch>',
    };
  }

  const remote = upstream.split('/')[0];
  try {
    git(repoRoot, 'fetch', remote);
  } catch (e) {
    return { status: 'failed', upstream, error: `git fetch ${remote} failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  const pulled = Number(git(repoRoot, 'rev-list', '--count', `HEAD..${upstream}`));
  if (pulled === 0) {
    return { status: 'current', upstream, pulled: 0 };
  }

  // Never discard uncommitted work.
  if (git(repoRoot, 'status', '--porcelain') !== '') {
    return {
      status: 'dirty',
      upstream,
      error: 'Working tree has uncommitted changes. Commit (or stash) them, then re-run `gbrain upgrade`.',
    };
  }

  // Instant-rollback point. Always created before the rebase touches anything.
  const id = opts.id ?? timestampId();
  const backupRef = `backup/pre-upgrade-${id}`;
  git(repoRoot, 'branch', backupRef);
  const backupDir = join(
    opts.backupBase ?? join(process.env.HOME || '', '.gbrain', 'upgrade-backups'),
    id,
  );

  const conflicts: ConflictRecord[] = [];
  try {
    try {
      git(repoRoot, 'rebase', upstream);
    } catch {
      // Conflict loop. Default policy: UPSTREAM WINS, patched version backed
      // up first. The AI re-application happens later, user-approved, via
      // skills/upgrade-resolve.
      let guard = 0;
      while (rebaseInProgress(repoRoot)) {
        if (++guard > 200) throw new Error('rebase conflict loop exceeded 200 iterations');
        const files = git(repoRoot, 'diff', '--name-only', '--diff-filter=U')
          .split('\n').filter(Boolean);
        if (files.length === 0) {
          throw new Error('rebase stopped without content conflicts (unsupported state — resolve manually)');
        }
        const commit = git(repoRoot, 'rev-parse', 'REBASE_HEAD');
        const subject = git(repoRoot, 'log', '-1', '--format=%s', commit);
        for (const file of files) {
          // 1. Preserve the pre-upgrade (patched) version BEFORE overwriting.
          let backupPath: string | null = null;
          try {
            const patched = git(repoRoot, 'show', `${backupRef}:${file}`);
            backupPath = join(backupDir, file);
            mkdirSync(dirname(backupPath), { recursive: true });
            writeFileSync(backupPath, patched + '\n');
          } catch {
            backupPath = null; // path had no pre-upgrade version (e.g. rename)
          }
          // 2. Upstream wins. NOTE: during a rebase, --ours = the upstream
          // branch being rebased onto (REVERSE of merge semantics) — intended.
          try {
            git(repoRoot, 'checkout', '--ours', '--', file);
            git(repoRoot, 'add', '--', file);
          } catch {
            // Upstream has no version of this path (upstream deleted it) →
            // upstream-wins means the file goes away.
            git(repoRoot, 'rm', '--quiet', '--ignore-unmatch', '--', file);
          }
          conflicts.push({ file, commit, subject, backupPath });
        }
        // 3. Continue — or skip if upstream-wins emptied the patch commit.
        let hasStagedChanges = false;
        try {
          git(repoRoot, 'diff', '--cached', '--quiet');
        } catch {
          hasStagedChanges = true;
        }
        try {
          git(repoRoot, 'rebase', hasStagedChanges ? '--continue' : '--skip');
        } catch {
          if (!rebaseInProgress(repoRoot)) throw new Error('rebase --continue failed in an unexpected way');
          // Next patch commit conflicted — the loop handles it.
        }
      }
    }
  } catch (e) {
    // Unrecoverable: put everything back exactly as it was, report loudly.
    try { git(repoRoot, 'rebase', '--abort'); } catch { /* not mid-rebase */ }
    try { git(repoRoot, 'reset', '--hard', backupRef); } catch { /* best-effort */ }
    return {
      status: 'failed', upstream, backupRef,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const replayed = Number(git(repoRoot, 'rev-list', '--count', `${upstream}..HEAD`));

  if (conflicts.length > 0) {
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(
      join(backupDir, 'manifest.json'),
      JSON.stringify({
        id, repoRoot, backupRef, upstream,
        createdAt: new Date().toISOString(),
        conflicts,
      }, null, 2) + '\n',
    );
    return { status: 'upgraded_with_conflicts', upstream, pulled, replayed, conflicts, backupRef, backupDir };
  }
  return { status: 'upgraded', upstream, pulled, replayed, backupRef };
}
