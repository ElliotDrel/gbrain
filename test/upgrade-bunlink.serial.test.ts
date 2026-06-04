import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { printBunLinkBriefing, runBunLinkUpgrade } from '../src/commands/upgrade-bunlink.ts';

// Isolate sandbox repos from the developer's global/system git config
// (autocrlf, commit signing, pull.rebase, etc.). Pointing GIT_CONFIG_GLOBAL /
// GIT_CONFIG_SYSTEM at an empty file works on every platform (/dev/null does
// not exist when git.exe is spawned directly on Windows).
const EMPTY_GIT_CONFIG = join(mkdtempSync(join(tmpdir(), 'gbrain-gitcfg-')), 'empty');
writeFileSync(EMPTY_GIT_CONFIG, '');

const GIT_ENV = {
  ...process.env,
  GIT_EDITOR: 'true',
  GIT_CONFIG_GLOBAL: EMPTY_GIT_CONFIG,
  GIT_CONFIG_SYSTEM: EMPTY_GIT_CONFIG,
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd, encoding: 'utf-8', timeout: 30_000, env: GIT_ENV,
  }).trim();
}

function commitFile(repo: string, file: string, content: string, msg: string) {
  const target = join(repo, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', msg);
}

let tmp: string;
let upstreamRepo: string;  // plays "origin"
let install: string;       // plays the bun-link clone
const GIT_SANDBOX_TIMEOUT = 20_000;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'gbrain-upg-'));
  upstreamRepo = join(tmp, 'upstream');
  mkdirSync(upstreamRepo);
  git(upstreamRepo, 'init', '-b', 'master');
  commitFile(upstreamRepo, 'a.txt', 'line1\nline2\nline3\n', 'base');
  install = join(tmp, 'install');
  git(tmp, 'clone', upstreamRepo, install);
  git(install, 'config', 'user.name', 't');
  git(install, 'config', 'user.email', 't@t');
});
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('runBunLinkUpgrade statuses', () => {
  test('already current', () => {
    const r = runBunLinkUpgrade(install, { id: 'test1', backupBase: join(tmp, 'bk') });
    expect(r.status).toBe('current');
  }, GIT_SANDBOX_TIMEOUT);

  test('no upstream tracking branch', () => {
    git(install, 'checkout', '-b', 'detached-feature');
    const r = runBunLinkUpgrade(install, { id: 'test2', backupBase: join(tmp, 'bk') });
    expect(r.status).toBe('no_upstream');
  }, GIT_SANDBOX_TIMEOUT);

  test('dirty tree aborts before touching anything', () => {
    commitFile(upstreamRepo, 'a.txt', 'line1 upstream\nline2\nline3\n', 'upstream change');
    writeFileSync(join(install, 'a.txt'), 'uncommitted local mess\n');
    const r = runBunLinkUpgrade(install, { id: 'test3', backupBase: join(tmp, 'bk') });
    expect(r.status).toBe('dirty');
    // uncommitted work untouched
    expect(readFileSync(join(install, 'a.txt'), 'utf-8')).toBe('uncommitted local mess\n');
  }, GIT_SANDBOX_TIMEOUT);
});

describe('runBunLinkUpgrade rebase', () => {
  test('no local commits: fast-forward equivalent', () => {
    commitFile(upstreamRepo, 'a.txt', 'line1 upstream\nline2\nline3\n', 'upstream change');
    const r = runBunLinkUpgrade(install, { id: 'ff1', backupBase: join(tmp, 'bk') });
    expect(r.status).toBe('upgraded');
    expect(r.pulled).toBe(1);
    expect(r.replayed).toBe(0);
    expect(git(install, 'rev-parse', 'HEAD')).toBe(git(install, 'rev-parse', 'origin/master'));
    expect(readFileSync(join(install, 'a.txt'), 'utf-8')).toContain('line1 upstream');
  }, GIT_SANDBOX_TIMEOUT);

  test('non-overlapping patch replays cleanly on top', () => {
    commitFile(install, 'patch.txt', 'my patch\n', 'patch: add patch.txt');
    commitFile(upstreamRepo, 'b.txt', 'upstream new file\n', 'upstream adds b');
    const r = runBunLinkUpgrade(install, { id: 'clean1', backupBase: join(tmp, 'bk') });
    expect(r.status).toBe('upgraded');
    expect(r.pulled).toBe(1);
    expect(r.replayed).toBe(1);
    expect(r.conflicts ?? []).toHaveLength(0);
    // both survive
    expect(existsSync(join(install, 'patch.txt'))).toBe(true);
    expect(existsSync(join(install, 'b.txt'))).toBe(true);
    // patch sits ON TOP of upstream
    expect(git(install, 'rev-parse', 'HEAD~1')).toBe(git(install, 'rev-parse', 'origin/master'));
  }, GIT_SANDBOX_TIMEOUT);

  test('same-line conflict: upstream wins, patched version backed up, manifest written', () => {
    commitFile(install, 'a.txt', 'line1 PATCHED\nline2\nline3\n', 'patch: change line1');
    commitFile(upstreamRepo, 'a.txt', 'line1 UPSTREAM\nline2\nline3\n', 'upstream: change line1');
    const backupBase = join(tmp, 'bk');
    const r = runBunLinkUpgrade(install, { id: 'conf1', backupBase });
    expect(r.status).toBe('upgraded_with_conflicts');
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts![0].file).toBe('a.txt');
    expect(r.conflicts![0].subject).toBe('patch: change line1');
    // upstream won in the tree
    expect(readFileSync(join(install, 'a.txt'), 'utf-8')).toContain('line1 UPSTREAM');
    // patched version preserved in the backup dir
    const backupPath = join(backupBase, 'conf1', 'a.txt');
    expect(r.conflicts![0].backupPath).toBe(backupPath);
    expect(readFileSync(backupPath, 'utf-8')).toContain('line1 PATCHED');
    // manifest written with clone root for the resolve skill
    const manifest = JSON.parse(readFileSync(join(backupBase, 'conf1', 'manifest.json'), 'utf-8'));
    expect(manifest.repoRoot).toBe(install);
    expect(manifest.backupRef).toBe('backup/pre-upgrade-conf1');
    expect(manifest.conflicts).toHaveLength(1);
    // backup ref points at pre-upgrade HEAD (contains the patched content)
    expect(git(install, 'show', 'backup/pre-upgrade-conf1:a.txt')).toContain('line1 PATCHED');
    // repo is NOT left mid-rebase
    expect(existsSync(join(install, '.git', 'rebase-merge'))).toBe(false);
    expect(existsSync(join(install, '.git', 'rebase-apply'))).toBe(false);
  }, GIT_SANDBOX_TIMEOUT);

  test('conflict backup preserves the exact patched blob bytes', () => {
    commitFile(install, 'a.txt', 'line1 PATCHED', 'patch: exact bytes');
    commitFile(upstreamRepo, 'a.txt', 'line1 UPSTREAM', 'upstream: exact bytes');
    const backupBase = join(tmp, 'bk');
    const r = runBunLinkUpgrade(install, { id: 'bytes1', backupBase });
    expect(r.status).toBe('upgraded_with_conflicts');
    expect(readFileSync(join(backupBase, 'bytes1', 'a.txt'), 'utf-8')).toBe('line1 PATCHED');
  }, GIT_SANDBOX_TIMEOUT);

  test('patch entirely swallowed by upstream-wins: commit skipped, rebase completes', () => {
    // Patch ONLY touches a.txt line1; upstream also touches it; after
    // upstream-wins the patch commit is empty and must be skipped.
    commitFile(install, 'a.txt', 'line1 PATCHED\nline2\nline3\n', 'patch: only line1');
    commitFile(upstreamRepo, 'a.txt', 'line1 UPSTREAM\nline2\nline3\n', 'upstream: line1');
    const r = runBunLinkUpgrade(install, { id: 'empty1', backupBase: join(tmp, 'bk') });
    expect(r.status).toBe('upgraded_with_conflicts');
    expect(r.replayed).toBe(0); // nothing of the patch survived
    expect(git(install, 'rev-parse', 'HEAD')).toBe(git(install, 'rev-parse', 'origin/master'));
  }, GIT_SANDBOX_TIMEOUT);

  test('upstream deleted a file the patch modified: upstream wins (file deleted), backup kept', () => {
    commitFile(install, 'a.txt', 'line1 PATCHED\nline2\nline3\n', 'patch: modify a.txt');
    git(upstreamRepo, 'rm', 'a.txt');
    git(upstreamRepo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'upstream: delete a.txt');
    const backupBase = join(tmp, 'bk');
    const r = runBunLinkUpgrade(install, { id: 'del1', backupBase });
    expect(r.status).toBe('upgraded_with_conflicts');
    expect(existsSync(join(install, 'a.txt'))).toBe(false); // upstream's delete won
    expect(readFileSync(join(backupBase, 'del1', 'a.txt'), 'utf-8')).toContain('line1 PATCHED');
  }, GIT_SANDBOX_TIMEOUT);

  test('multiple patch commits, mixed clean and conflicting', () => {
    commitFile(install, 'patch.txt', 'standalone patch\n', 'patch: clean one');
    commitFile(install, 'a.txt', 'line1 PATCHED\nline2\nline3\n', 'patch: conflicting one');
    commitFile(upstreamRepo, 'a.txt', 'line1 UPSTREAM\nline2\nline3\n', 'upstream: line1');
    const r = runBunLinkUpgrade(install, { id: 'mix1', backupBase: join(tmp, 'bk') });
    expect(r.status).toBe('upgraded_with_conflicts');
    expect(r.replayed).toBe(1);            // the clean patch survived
    expect(r.conflicts).toHaveLength(1);   // the conflicting one got upstream-wins'd
    expect(existsSync(join(install, 'patch.txt'))).toBe(true);
    expect(readFileSync(join(install, 'a.txt'), 'utf-8')).toContain('line1 UPSTREAM');
  }, GIT_SANDBOX_TIMEOUT);

  test('backup ref is always created on any non-trivial upgrade', () => {
    commitFile(upstreamRepo, 'a.txt', 'line1 up\nline2\nline3\n', 'upstream');
    const r = runBunLinkUpgrade(install, { id: 'ref1', backupBase: join(tmp, 'bk') });
    expect(r.backupRef).toBe('backup/pre-upgrade-ref1');
    // ref exists and points at the pre-upgrade HEAD
    expect(() => git(install, 'rev-parse', '--verify', 'backup/pre-upgrade-ref1')).not.toThrow();
  }, GIT_SANDBOX_TIMEOUT);
});

describe('upgrade.ts bun-link wiring (source analysis)', () => {
  const source = readFileSync(
    new URL('../src/commands/upgrade.ts', import.meta.url),
    'utf-8',
  );

  test('bun-link case calls runBunLinkUpgrade, not pull --ff-only', () => {
    expect(source).toContain('runBunLinkUpgrade(');
    expect(source).not.toContain("'pull', '--ff-only'");
  });

  test('verify gate: typecheck runs after bun install on bun-link path', () => {
    expect(source).toContain("['run', 'typecheck']");
    expect(source).toContain("['--version']");
  });

  test('verify failure rolls back hard to the backup ref', () => {
    expect(source).toContain("'reset', '--hard'");
  });

  test('briefing printer exists and is invoked', () => {
    expect(source).toContain('printBunLinkBriefing(');
  });
});

describe('printBunLinkBriefing', () => {
  test('conflict briefing tells the operator what happened and where backups are', () => {
    const lines: string[] = [];
    const originalLog = console.log;
    try {
      console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
      printBunLinkBriefing({
        status: 'upgraded_with_conflicts',
        upstream: 'origin/master',
        pulled: 3,
        replayed: 1,
        backupRef: 'backup/pre-upgrade-20260603-120000',
        backupDir: '/home/e/.gbrain/upgrade-backups/20260603-120000',
        conflicts: [{
          file: 'src/example.ts',
          commit: 'abc123',
          subject: 'patch: local behavior',
          backupPath: '/home/e/.gbrain/upgrade-backups/20260603-120000/src/example.ts',
        }],
      });
    } finally {
      console.log = originalLog;
    }

    const output = lines.join('\n');
    expect(output).toContain('Pulled 3 upstream commit(s); 1 local patch(es) replayed cleanly.');
    expect(output).toContain('upstream version kept');
    expect(output).toContain('/home/e/.gbrain/upgrade-backups/20260603-120000');
    expect(output).toContain('backup/pre-upgrade-20260603-120000');
    expect(output).toContain('upgrade-resolve skill');
  });
});
