---
name: upgrade-resolve
description: |
  Re-apply local gbrain patches across an upstream upgrade — whether via
  `gbrain upgrade` (backup-manifest) or a manual `git rebase origin/master` of
  the fork's patch stack. ALWAYS read PATCH.md in full FIRST (it's the map of
  what the fork carries and why), reconstruct each patch's INTENT onto the new
  upstream code, then refresh PATCH.md (header + entries) at the end — mandatory.
triggers:
  - "resolve upgrade conflicts"
  - "re-apply my patches"
  - "reapply my patches"
  - "upgrade resolve"
  - "the upgrade had conflicts"
  - "restore my gbrain patches"
  - "rebase gbrain onto upstream"
  - "update gbrain fork"
  - "upgrade the gbrain fork"
  - "gbrain upgrade with patch stack"
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

## Contract

This skill guarantees:
- Nothing changes without explicit user approval (mandatory stop before any edit).
- Re-applies each patch's INTENT onto the new upstream code -- never pastes old lines back.
- Classifies every conflict via its PATCH.md entry (Section A permanent vs Section B ephemeral) and DROPS bug fixes upstream has since fixed.
- Typecheck-gated: a re-application that fails typecheck is reverted and flagged, never left broken.
- Propagates updated skills to the live workspace and reports rollback points (backupRef + backup dir).

> **Applies to BOTH upgrade flows.** Whether the upgrade ran via `gbrain
> upgrade` (bun-link backup-manifest path, below) OR a manual
> `git fetch && git rebase origin/master` of the fork's patch stack (the flow
> for installs that carry a local patch series — conflicts resolved inline
> during the rebase rather than from a backup manifest), the PATCH.md
> read-first / refresh-last discipline in Hard rule 0 and step 5 is mandatory
> either way.

## Hard rules

0. **Read `PATCH.md` IN FULL before touching anything.** It is the map of every
   change the fork carries on top of upstream and WHY — you cannot classify a
   conflict (Section A vs B), know what to drop, or adapt an intent to new
   upstream shape without it. Reading it first is what gives you context on
   "what is going on" in this repo. Never start resolving conflicts blind.
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
- **Refresh `PATCH.md` — MANDATORY, both the header AND the entries (commit message: `docs(PATCH.md): refresh after upgrade <id>`):**
  - **Header:** update the `Last updated: <date> (on gbrain <NEW version>)` line and write a one-paragraph audit summary for this upgrade — which versions came in, which files conflicted and how each was resolved, and which Section B entries flipped to retired. The header is the at-a-glance state of the fork; a stale header (wrong version, mislabeled entry) silently misleads the NEXT upgrade.
  - **Entries:** mark each affected entry's `Status:` (retired/active) and refresh its intent if upstream changed the surface.
  - Do this WITHOUT being asked — it is part of "done," not a follow-up the user has to request.
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

## Output Format

A final briefing (step 7), per conflicted file:
- **Re-applied:** `<file>` -- how the new code differs from the old patch.
- **Skipped (upstreamed):** `<file>` -- PATCH.md entry marked `Status: retired`.
- **Flagged:** `<file>` -- why it could not be auto-re-applied (the three reference points).

Then: verify-gate result (`bun run typecheck` pass/fail), workspace propagation result
(step 6), and rollback points (`backupRef`, backup dir).

## Anti-Patterns

- Starting conflict resolution without reading `PATCH.md` in full first (violates Hard rule 0) — you'll misclassify Section A vs B and re-apply something upstream already fixed.
- Leaving the `PATCH.md` HEADER stale after an upgrade (wrong `Last updated` version, mislabeled entry status) — the header is the at-a-glance fork state; a stale header misleads the next upgrade. Refreshing per-entry but not the header is the common miss.
- Running unattended or editing any file before the user approves (violates Hard rule 1).
- Pasting old patch text back verbatim instead of reconstructing intent on the new upstream code.
- Re-applying a Section B bug fix that upstream already fixed -- creates two conflicting
  solutions to one problem; upstream's fix is authoritative.
- Declaring done without the typecheck gate, or leaving a typecheck-failing re-application in place.
- Skipping step 6, so the fork is committed but the live workspace never gets the updated skills.
- Deleting the backup directory before the user has confirmed the result.
