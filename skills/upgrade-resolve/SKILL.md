---
name: upgrade-resolve
description: |
  Re-apply local gbrain patches after `gbrain upgrade` resolved conflicts
  upstream-wins. Reads the backup manifest, asks the user for approval, then
  reconstructs each patch's INTENT (from PATCH.md) onto the new upstream code.
triggers:
  - "resolve upgrade conflicts"
  - "re-apply my patches"
  - "reapply my patches"
  - "upgrade resolve"
  - "the upgrade had conflicts"
  - "restore my gbrain patches"
tools:
  - exec
  - read
mutating: true
---

# Upgrade Resolve — re-apply patches after an upstream-wins upgrade

`gbrain upgrade` (bun-link) rebases local patch commits onto upstream. When a
file conflicts, the upgrade keeps the UPSTREAM version and backs up the patched
version. This skill re-applies the patch intent afterward. It NEVER runs
unattended.

## Hard rules

1. **Ask the user before changing anything.** Show what conflicted and what you
   plan to re-apply. Proceed only on explicit approval.
2. **Re-apply INTENT, not text.** You are reconstructing what the patch was FOR
   on top of the new upstream code — not pasting old lines back.
3. **Never guess.** If you cannot confidently re-apply an intent (the upstream
   code changed shape, the PATCH.md entry is missing or ambiguous), flag that
   file for the user with the three reference points and STOP for that file.
4. **Verify before declaring done.** Typecheck must pass; failing means revert
   your re-application and flag.
5. **Classify before re-applying (PATCH.md Section A vs B).** Every conflicted
   file maps to a `PATCH.md` entry that is either a **Permanent Customization**
   (Section A — always re-apply) or an **Ephemeral Bug Fix** (Section B — carry
   only until upstream fixes it). A bug fix that upstream has since fixed MUST be
   **dropped, not re-applied**: re-applying creates two conflicting solutions to
   one problem, and upstream's fix is authoritative. See step 3.

## Workflow

### 1. Locate the work

- Find the newest backup: `ls -t ~/.gbrain/upgrade-backups/ | head -1`
  (or the user names a specific `<id>`).
- Read `~/.gbrain/upgrade-backups/<id>/manifest.json`. It contains:
  `repoRoot` (the gbrain clone — do NOT assume cwd), `backupRef`, `upstream`,
  and `conflicts[]` (`file`, `commit`, `subject`, `backupPath`).

### 2. Ask for approval (mandatory stop)

Present to the user, per conflicted file: the file path, the patch commit
subject, and the matching `PATCH.md` entry title (read `PATCH.md` at
`repoRoot`). Ask: "Re-apply these patches now?" Do not continue without a yes.
Honor partial approval (only the files the user picks).

### 3. Re-apply, one file at a time

For each approved file, gather the three reference points:
- **New upstream code:** `<repoRoot>/<file>` as it is now.
- **Old patched code:** the `backupPath` copy.
- **Intent:** the `PATCH.md` entry covering this file (its *Change / Why /
  How to recreate* fields). Also `git -C <repoRoot> show <commit>` for the
  original patch diff if more context helps.

**First, classify the file via its `PATCH.md` entry (Section A or B):**

- **Section B — Ephemeral Bug Fix:** run the entry's **Drop-when** check against
  the new upstream code. If upstream now fixes the bug → **DROP it: do NOT
  re-apply, skip the file, and mark the entry `Status: retired (upstreamed vX)`.**
  Trust upstream's fix. If upstream has NOT fixed it → re-apply the intent (below).
- **Section A — Permanent Customization:** always re-apply the intent (below).

**To re-apply:** rewrite `<repoRoot>/<file>` so the patch's intent holds on the
new upstream code. If intent and upstream now genuinely collide (upstream
implemented the same thing differently, or removed the surface the patch
modified), do NOT force it — flag per Hard Rule 3. If upstream absorbed a
Section A customization wholesale, treat it like a resolved Section B item: skip
and mark **Status: retired (upstreamed)**.

### 4. Verify gate

From `repoRoot`: `bun install` (if not already run) then `bun run typecheck`.
On failure: revert your edits to that file (`git -C <repoRoot> checkout -- <file>`),
flag it, and continue with the rest.

### 5. Commit + bookkeeping

- One commit per logical patch re-applied:
  `git -C <repoRoot> add <files> && git -C <repoRoot> commit -m "patch: re-apply <subject> after upgrade <id>"`
- Refresh the matching `PATCH.md` entries (commit message: `docs(PATCH.md): refresh after upgrade <id>`).
- Leave the backup directory in place (forensics); the user can delete old ones.

### 6. Propagate updated skills to the live workspace

After the fork is committed, push the upgraded skill content into the running
OpenClaw workspace so the changes actually go live:

    bash /home/supe/.openclaw/workspace/scripts/sync-skills-from-fork.sh

This overwrites the workspace's copies of the consumer skills (the set declared in
`openclaw.plugin.json`) from the fork. Safe and idempotent — the workspace copies
are disposable mirrors of the fork, never hand-edited. Note what it updated.

### 7. Final briefing (mandatory)

Report exactly: which files were re-applied and HOW the new code differs from
the old patch, which were skipped as upstreamed, which were flagged and why,
verify-gate result, the **workspace propagation result** (step 6: skills updated),
and the rollback points (`backupRef`, backup dir).
