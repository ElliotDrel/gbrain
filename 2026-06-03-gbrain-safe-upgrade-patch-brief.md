# Brief: gbrain safe-upgrade patch preservation (slight tweak to existing upgrade)

**Date:** 2026-06-03
**Status:** Final — approved through brainstorm + prompt-builder flow
**Base:** `ElliotDrel/gbrain` GitHub `master` (`8fea6b8`) — NOT the stale local checkout (219 behind), NOT `garrytan/gbrain`. This is the version Elliot's OpenClaw install runs.

> **Implementer warning:** the stale local working tree does NOT contain the `bun-link` case or `detectBunLink()` — they exist only at `origin/master`. Check out the feature branch off `origin/master` BEFORE reading any code, or nothing below will make sense.

---

Elliot keeps small personal modifications ("patches") to his gbrain install and wants to always stay on the latest upstream version. The job is a small tweak to the **existing** `gbrain upgrade` command — not a new update process — plus a tracked `PATCH.md` manifest and a conflict-resolution skill.

## Target & current behavior

The install is a `bun-link` source clone (Linux, via OpenClaw). bun-link runs straight from the git clone; today the `bun-link` branch of `src/commands/upgrade.ts` does `git pull --ff-only && bun install`, which refuses to run once local commits exist. Local patches are kept as real git commits on the clone's branch, ahead of its configured remote. The update-check cron is untouched: it detects and notifies only; Elliot manually tells the agent to run `gbrain upgrade`. All existing upgrade scaffolding (install-method detection, `detectBunLink`, post-upgrade migration discovery, `recordUpgradeError` trails, features scan) stays exactly as is.

## Build three things

1. **Tweak the `bun-link` case of `src/commands/upgrade.ts`.** Changes are scoped to the `bun-link` case only — no refactoring of unrelated logic. Replace the `git pull --ff-only` step with:
   - `git fetch`; exit "already current" if the remote tracking branch isn't ahead.
   - Require a clean working tree — abort with a clear message if dirty; never discard work.
   - Create backup ref `backup/pre-upgrade-<id>`. `<id>` = `YYYYMMDD-HHMMSS` timestamp, and the **same `<id>` value** is used for the backup directory below — the resolve skill correlates the two by it.
   - `git rebase` onto the branch's configured upstream (same remote semantics as the old `pull`).
   - **On conflict, the default is automatic and safe:** back up Elliot's patched version of each conflicted file to `~/.gbrain/upgrade-backups/<id>/<path>`, plus a `manifest.json` noting the clone root path and, per file, which patch commit it came from. Keep the **upstream** version: `git checkout --ours` during rebase — note that during a rebase `--ours` resolves to the upstream branch being rebased onto (the reverse of merge semantics), which is exactly the intended upstream-wins behavior. Use `git rebase --skip` if a patch commit becomes empty. Finish the rebase; the repo is never left mid-rebase.
   - Then `bun install`, verify gate (`bun run typecheck` + `gbrain --version` smoke). On verify failure: print the failing output first so Elliot sees what broke, then `git reset --hard backup/pre-upgrade-<id>` and re-run `bun install` to restore the pre-upgrade `node_modules` state.
   - Print a briefing (plain console output, matching the existing upgrade output style): upstream commits pulled, patches replayed cleanly, conflicted files now on upstream + backup location + "run the resolve step to re-apply."
   - After a successful rebase + verify, set `upgraded = true` so the existing `saveUpgradeState` / `gbrain post-upgrade` / features-scan flow still fires exactly as today.
   - **Compatibility:** with zero local commits, behavior must be indistinguishable from today's fast-forward pull.

2. **`PATCH.md`, tracked at repo root** and committed to the fork (it ships upstream — a visible but harmless file for any clone, and PR-able someday). Format: one level-2 heading per patch (patch name), with four labeled fields below it — **Intent**, **Scope** (files touched), **How to recreate** (steps), **Status** (active/retired). Intent, not code snippets (code rots; intent doesn't). Ships with a header explaining the format and one commented-out example entry; real entries are written on the install where patches are made.

3. **A resolve skill** (markdown, placed and named per the skill layout that exists at `origin/master` — check the convention there, not in the stale tree). When an upgrade reports conflicts, the agent **first asks Elliot for approval**, then for each backed-up file re-applies the documented intent onto the new upstream code using three reference points: the new upstream file, the backed-up patched file, and the `PATCH.md` entry. The skill's first step reads `manifest.json` in the backup dir to locate the clone root (do not assume cwd). Commit the re-applied patch, re-run the verify gate, refresh `PATCH.md`, and give a final briefing of exactly what was changed and how. If intent can't be confidently re-applied, flag it for Elliot — never guess.

## Constraints

- No new commands; `gbrain upgrade` stays the only entry point.
- AI resolution never runs unattended — explicit user approval first.
- Nothing is ever lost: backup ref + backup dir before any overwrite.
- Cron unchanged. Non-bun-link install paths unchanged. No skill-copy sync machinery. No auto-upgrades.
- Production-grade: clean commits, repo-convention code, PR-able upstream one day. Diff scoped to the `bun-link` case, the new files (`PATCH.md`, resolve skill), and tests — nothing else moves.

## Delivery path

1. Branch `feat/safe-upgrade` off `origin/master` (`8fea6b8`) in the local Windows checkout.
2. Implement + test there (full suite + a sandbox-git-repo simulation of a conflicting upgrade).
3. Ship via the repo's standard process to `ElliotDrel/gbrain` master.
4. On the OpenClaw machine: plain `gbrain upgrade` picks it up if the clone has no local commits; otherwise one-time manual `git fetch && git rebase && bun install`. From then on the new logic protects all future patches.

## Quality bar & definition of done

Follow the repo's existing practices, including tests (study `test/upgrade.test.ts` / `test/check-update.test.ts` patterns; cover backup creation, upstream-wins resolution, dirty-tree abort, already-current exit, briefing output; full unit + E2E suites pass per the repo's pre-ship requirements). Done = modified `upgrade.ts` + seeded `PATCH.md` + resolve skill + passing tests, shipped to the fork, with the one-time bootstrap note for the OpenClaw machine.

---

**Implementation notes (post-build, 2026-06-03):** PATCH.md already existed at `origin/master` with 5 entries — its existing format (`## N. MODIFIED <kind> — <path>` with Change/Edit made/Why/How to recreate) was kept; only the protocol header was added. Delivery changed by user decision: the branch is pushed to the fork but NOT merged to master and NOT shipped via /ship — the OpenClaw machine pulls the branch directly (see `gbrain-safe-upgrade-openclaw-merge-runbook.md` in Downloads).
