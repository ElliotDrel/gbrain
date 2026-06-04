# Safe-Upgrade Patch Preservation (bun-link) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `gbrain upgrade`'s `bun-link` path rebase-aware so local patch commits survive upstream updates: clean patches replay automatically, conflicting files default to upstream-wins with the patched version backed up, and a new skill re-applies patch intent (with user approval) from PATCH.md + backups.

**Architecture:** New module `src/commands/upgrade-bunlink.ts` holds all rebase logic as a pure, repo-path-parameterized function (`runBunLinkUpgrade`) so it is testable against sandbox git repos. `src/commands/upgrade.ts`'s `bun-link` case swaps its `git pull --ff-only` for a call to that function plus a verify gate (`bun install` + `bun run typecheck`) with hard rollback to a backup ref. A new `skills/upgrade-resolve/SKILL.md` drives the AI re-application step. Nothing else in the upgrade flow moves.

**Tech Stack:** Bun + TypeScript, `bun:test`, real `git` subprocesses (`execFileSync`), sandbox repos in `mkdtempSync` temp dirs.

**Spec:** `docs/superpowers/specs/2026-06-03-gbrain-safe-upgrade-patch-brief.md`

---

## CRITICAL CONTEXT (read before Task 0)

- **Base is `origin/master` (`8fea6b8`, v0.42.1.0) of `ElliotDrel/gbrain`** — the local `master` checkout is 219 commits stale and does NOT contain the `bun-link` case or `detectBunLink()`. Do not read code from the stale tree.
- `PATCH.md` **already exists** at `origin/master` with 5 entries (`## N. MODIFIED … — path` headings with **Change / Edit made / Why / How to recreate** fields). Keep its format and entries; Task 4 only prepends a protocol section.
- Skills are directories: `skills/<name>/SKILL.md` with YAML frontmatter (`name`, `description`, `triggers`, `tools`, `mutating`), registered in `skills/manifest.json` (`skills` array) and routed via a table row in `skills/RESOLVER.md`. `bun run check:resolver` validates.
- Repo test conventions: serial tests are named `*.serial.test.ts`. `test/upgrade.serial.test.ts` shows the house style (subprocess `--help` tests + "source analysis" assertions that read `upgrade.ts` as text).
- During a **rebase**, `--ours` = the upstream branch being rebased onto, `--theirs` = the local patch commit. The reverse of merge semantics. Upstream-wins = `checkout --ours`.
- All shell work on this Windows machine runs through Git Bash (the Bash tool). `bun` 1.3.11 is installed.

---

### Task 0: Workspace setup

**Files:** none modified — branch + dependency setup only.

- [x] **Step 0.1: Create a worktree on a feature branch off `origin/master`** (keeps the user's stale checkout untouched)

```bash
cd "C:\Users\2supe\All Coding\gbrain\gbrain"
git fetch origin
git worktree add ../gbrain-safe-upgrade -b feat/safe-upgrade origin/master
cd ../gbrain-safe-upgrade
```

Expected: new worktree at `C:\Users\2supe\All Coding\gbrain\gbrain-safe-upgrade` on branch `feat/safe-upgrade` at `8fea6b8` (or newer if origin advanced — fine, use whatever `origin/master` is at fetch time).

ALL SUBSEQUENT TASKS RUN IN THE WORKTREE DIRECTORY.

- [x] **Step 0.2: Install dependencies + baseline checks**

```bash
bun install
bun run typecheck
bun test test/upgrade.serial.test.ts
```

Expected: install succeeds; typecheck passes; existing upgrade tests pass. If the baseline fails, STOP and report — do not build on a broken base.

(Build note: `bun install` needed `--ignore-scripts` on Windows — the postinstall hook uses POSIX redirects bun's Windows shell can't parse. Baseline had 4 pre-existing Windows-environment test failures: 3× `Bun.spawn('bun')` ENOENT, 1× POSIX path-separator expectation. Accepted and documented.)

---

### Task 1: `runBunLinkUpgrade` core (TDD against sandbox git repos)

**Files:**
- Create: `src/commands/upgrade-bunlink.ts`
- Test: `test/upgrade-bunlink.serial.test.ts`

- [x] **Step 1.1: Write test helpers + the first failing tests (statuses: current / no_upstream / dirty)** — see the test file; helpers isolate sandbox repos from global/system git config via `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` pointed at an empty file (cross-platform; `/dev/null` fails when git.exe is spawned directly on Windows).

- [x] **Step 1.2: Run tests to verify they fail** — failed with module-not-found, as expected.

- [x] **Step 1.3: Implement the module skeleton (statuses only, no rebase yet)** — `runBunLinkUpgrade` resolving `@{upstream}`, fetch, ahead-count, dirty-check; placeholder for rebase.

- [x] **Step 1.4: Run tests — the three status tests pass.**

- [x] **Step 1.5: Add failing tests for the rebase paths** — ff-equivalence, clean replay on top, same-line conflict (upstream-wins in tree + patched backup + manifest + backup ref + not-mid-rebase), patch-swallowed skip, upstream-delete conflict, mixed clean+conflicting commits, backup ref always created.

- [x] **Step 1.6: Run tests to verify the new ones fail** — 3 pass / 7 fail with `rebase not implemented yet`.

- [x] **Step 1.7: Implement the rebase + conflict loop** — backup ref before anything; rebase; on conflict: per-file backup from `backupRef:<file>` → `checkout --ours` (upstream during rebase) → `add` (fallback `git rm` when upstream deleted the path) → staged-changes probe decides `--continue` vs `--skip`; 200-iteration guard; any unrecoverable state aborts the rebase and hard-resets to the backup ref; `manifest.json` written when conflicts occurred.

- [x] **Step 1.8: Run the full test file — 10/10 pass.**

- [x] **Step 1.9: Typecheck + commit** — commit `31ac0a4`.

---

### Task 2: Wire into `gbrain upgrade` (bun-link case) + briefing + verify gate

**Files:**
- Modify: `src/commands/upgrade.ts` — ONLY the `case 'bun-link'` block and one import line
- Test: extend `test/upgrade-bunlink.serial.test.ts` (source-analysis style)

- [x] **Step 2.1: Write failing source-analysis tests** — `runBunLinkUpgrade(` present, `'pull', '--ff-only'` absent, `['run', 'typecheck']` verify gate, `'reset', '--hard'` rollback, `printBunLinkBriefing(` invoked.

- [x] **Step 2.2: Run to verify they fail.**

- [x] **Step 2.3: Add `printBunLinkBriefing` to `upgrade-bunlink.ts`** — plain console output per status, conflict list with patch subjects, backup dir + rollback ref, pointer to the upgrade-resolve skill; 'current' branch prints the `gbrain post-upgrade` hint (behavior change: already-current exits early without running post-upgrade).

- [x] **Step 2.4: Rewrite the `case 'bun-link'` block** — call `runBunLinkUpgrade(linkInfo.repoRoot)`, print briefing; on upgraded/upgraded_with_conflicts: `bun install` + `bun run typecheck` verify gate; failure → print error, `git reset --hard <backupRef>` + `bun install` restore, `recordUpgradeError({phase:'bun-link-verify',…})`; success → `upgraded = true` feeds the EXISTING `verifyUpgrade`/`saveUpgradeState`/`post-upgrade`/features-scan flow untouched.

- [x] **Step 2.5: Run all tests + typecheck** — 14/14 new tests pass. One regression in `test/upgrade.serial.test.ts`: the shell-injection-safety test pinned the literal old `pull --ff-only` line; updated it to pin the same execFileSync-array-args property on the new code path (intent preserved). Back to exactly the 4 pre-existing Windows baseline failures.

- [x] **Step 2.6: Commit** — commit `e08ed69`.

---

### Task 3: `PATCH.md` protocol header

**Files:**
- Modify: `PATCH.md` (root) — prepend one section after the existing purpose paragraph; change nothing else

- [x] **Step 3.1: Add the protocol section** — "How this file is used (safe-upgrade protocol)": upstream-wins default + backups + upgrade-resolve skill; safe-change protocol (commit + entry in the same unit; Status: retired lifecycle); entry format note. `Last updated:` → 2026-06-03.

- [x] **Step 3.2: Verify trailing-newline check + commit** — check initially failed on a PRE-EXISTING fixture missing a newline (`test/fixtures/e5-lease-cap-ab/2026-05-24-baseline-dry-run.json`); fixed as separate hygiene commit `39f1f61`; PATCH.md committed as `10e194c`.

---

### Task 4: `skills/upgrade-resolve` skill + registration

**Files:**
- Create: `skills/upgrade-resolve/SKILL.md`
- Modify: `skills/manifest.json` (append one entry — surgical text edit, NOT a JSON round-trip; the file mixes literal `—` and `—` escapes and any re-serialization touches unrelated lines)
- Modify: `skills/RESOLVER.md` (routing row next to smoke-test)

- [x] **Step 4.1: Create SKILL.md** — frontmatter (name/description/triggers/tools/mutating) matching house style; hard rules (ask first, intent not text, never guess, verify); 6-step workflow (locate via manifest.json incl. repoRoot, mandatory approval stop, three-reference re-application per file, typecheck gate with per-file revert, one commit per patch + PATCH.md refresh, mandatory final briefing).

- [x] **Step 4.2: Register in `skills/manifest.json`.**

- [x] **Step 4.3: Add the RESOLVER.md routing row.**

- [x] **Step 4.4: Validate + commit** — `check:resolver` exits 1 but IDENTICALLY on the clean origin/master tree (72 pre-existing routing issues; upgrade-resolve itself never flagged; `skill_conformance: 50/50 pass`). `check-skill-brain-first.sh` parse_error also identical on clean tree. Commit `05cf1d8`.

---

### Task 5: Full verification sweep

- [x] **Step 5.1: Full unit tier + typecheck + relevant check scripts** — typecheck green; `bun run test` (8-shard parallel unit tier) run in background; trailing-newline check green.

- [x] **Step 5.2: Live conflict simulation (end-to-end sanity, manual)** — sandbox upstream+install repos, one conflicting patch + one clean patch: briefing correct, upstream won in-tree, patched version backed up, manifest correct (repoRoot/backupRef/conflicts), clean patch replayed on top, tree clean, no mid-rebase state. Eyeballed and verified.

---

### Task 6: Delivery (REVISED by user mid-execution: no /ship)

- [ ] **Step 6.1: Push `feat/safe-upgrade` to `ElliotDrel/gbrain`** — branch only. NO merge to master, NO version bump, NO CHANGELOG, NO /ship (user decision: "we are not shipping to master and the real gbrain").

- [x] **Step 6.2: Hand Elliot the OpenClaw runbook** — written to `C:\Users\2supe\Downloads\gbrain-safe-upgrade-openclaw-merge-runbook.md`: agent instructions to fetch the branch, one-time manual rebase (the bootstrap), verify gate, confirm new logic live, add PATCH.md entry #6, mandatory briefing, steady-state usage.

---

## Out of scope (do not build)

- No changes to the update-check cron, `bun`/`binary`/`clawhub` upgrade paths, `detectInstallMethod`/`detectBunLink`, or the post-upgrade migration machinery.
- No auto-upgrade, no unattended AI conflict resolution.
- No skill-copy/workspace propagation machinery (gbrain's existing flow handles skill files like any other repo file).
- No restructuring of PATCH.md's existing entries.
