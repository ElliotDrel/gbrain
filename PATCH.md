# PATCH.md — gbrain fork patch manifest

**Purpose.** Manifest of changes this private fork carries on top of upstream
`garrytan/gbrain`, so they can be re-applied (or correctly *dropped*) after an
upgrade. Only gbrain-owned files that an update can overwrite belong here —
NOT plain OpenClaw-local additions (custom workspace skills, conventions,
workspace scripts) unless they've been moved upstream into gbrain itself.

No code snippets — only intent, scope, and enough pointers to rebuild quickly.

Last updated: 2026-06-04 (on gbrain 0.42.24.0).

---

## The two categories (READ THIS FIRST — for the AI)

Every entry is one of two kinds, with **opposite lifecycles**:

- **Section A — Permanent Customizations.** Things upstream will *never* ship
  (they're ours). On every upgrade: **always re-apply the intent.** A conflict
  here means upstream refactored the surface we hook into — adapt our change to
  the new shape.

- **Section B — Ephemeral Bug Fixes.** Local fixes that exist *only* until
  upstream ships its own. The goal is for them to **die.** On every upgrade,
  for each Section B entry: **first check whether upstream has now fixed it**
  (each entry's **Drop-when** field says exactly how to check). If upstream
  fixed it → **DROP it. Do NOT re-apply.** Mark **Status: retired** and trust
  upstream's fix. If upstream has *not* fixed it → re-apply.

**Why the asymmetry matters:** re-migrating a bug fix that upstream already
fixed produces *two conflicting solutions to the same problem*. Upstream's fix
is authoritative (deeper codebase knowledge), so once it lands, ours must go.
Customizations have no upstream equivalent, so they persist.

> If a Section A customization is ever genuinely shipped by upstream too, treat
> it like a resolved Section B item: retire ours, keep upstream's.

---

## How this file is used (safe-upgrade protocol)

`gbrain upgrade` (bun-link installs) rebases local patch commits onto upstream.
Where upstream touched the same lines, **upstream wins by default** and the
patched file is backed up to `~/.gbrain/upgrade-backups/<id>/` with a
`manifest.json`. The `skills/upgrade-resolve` skill then — with explicit user
approval — decides per conflicted file using the category above:

- **Section A (customization):** re-apply the patch's INTENT onto the new
  upstream code (three reference points: new upstream file, backed-up patched
  file, this entry).
- **Section B (bug fix):** evaluate **Drop-when**. Resolved upstream → retire,
  do not re-apply. Not resolved → re-apply the intent.

**Safe-change protocol (making a patch that survives upgrades):**
1. Make the change and commit it on the clone's branch (never leave it uncommitted).
2. Add/refresh this file's entry in the same logical unit — intent, not code —
   in the correct section (A or B). For Section B, fill **Upstream** + **Drop-when**.
3. Prefer **new files** over inline edits for customizations (new files never
   conflict). Keep inline wiring minimal.
4. When a patch is upstreamed or abandoned, mark its entry **Status: retired**
   (don't delete — history stays greppable).

Entry format: `## <id>. <kind> — <path>` with **Change / Edit made / Why / How
to recreate**; Section B adds **Upstream / Drop-when / Status**.

═══════════════════════════════════════════════════════════════════════
# Section A — Permanent Customizations (ALWAYS re-apply)
═══════════════════════════════════════════════════════════════════════

## A1. MODIFIED stock skill — `skills/media-ingest/SKILL.md`
**Change:** Phase 3's page template originally had **no frontmatter and no
tags**, so pages shipped untagged (a real retrieval miss — caught 2026-06-01).
**Edit made:** added a YAML frontmatter block to the template (`type`, `title`,
mandatory `tags:` guidance with a prefer-existing reminder) and an **Author:**
line. The rule lives in the template itself — deliberately not duplicated as a
separate skill-body instruction.
**Why:** untagged pages don't connect; tags are the graph's edges.
**How to recreate:** in Phase 3 ("Create brain page"), prepend frontmatter with a
mandatory tags block to the template and add the tagging-convention callout.

## A2. MODIFIED gbrain source — `src/commands/files.ts`
**Change:** `gbrain files upload-raw` was adjusted so small raw files are copied
into a page-local git sidecar directory instead of being treated like loose temp
files.
**Edit made:** small text/PDF raw uploads now resolve the default source path,
derive the owning page path, create a `<page>.raw/` sidecar next to that page,
copy the file there, and register the stored path in the `files` table. The
cloud-upload path was also cleaned up so local-hash vs cloud-hash handling is
less error-prone.
**Why:** raw provenance should live alongside the page it supports and survive
normal git workflows, instead of floating around in temp storage.
**How to recreate:** reapply the sidecar-copy behavior in `uploadRaw`, including
source-path resolution, page-sidecar derivation, db registration, and the hash
cleanup in the cloud path.

## A3. MODIFIED stock skill — `skills/meeting-ingestion/SKILL.md` (→ v2.0.0)
**Change:** merged Elliot's custom `post-meeting-flow` behavior into the stock
gbrain `meeting-ingestion` skill so a meeting is handled by ONE skill, not two.
**Edit made:** rewrote `meeting-ingestion` (v1.0.0 → v2.0.0) to add, on top of the
shipped behavior (attendee enrichment, entity propagation, timeline merge,
bidirectional back-links, raw-transcript preservation — all preserved):
- a **review-before-ingest loop** (build a draft, show the user, iterate, ingest
  only after approval);
- the fixed notes structure **Executive Summary → Key Takeaways → Key Decisions
  (optional) → Learnings or Useful Later (optional) → Action Items → Next Steps →
  Meeting Historical Breakdown → `## Timeline` (last)**, replacing the old
  `Summary / Key Decisions / Action Items / Discussion Notes` template;
- `Action Items` vs `Next Steps` split; optional `Key Decisions` and optional
  `Learnings or Useful Later`;
- `Action Items` includes a **promise-scan**: detect promises/commitments the
  user made to others in the meeting and add each as its own action item, tagged
  `(promise)` so it's visually distinct;
- chronological `Meeting Historical Breakdown` (replaces "Discussion Notes");
- `raw_transcript:` enforced as a **frontmatter pointer** to the `.raw/` sidecar,
  never a body section;
- post-ingest **engine verification** (`gbrain get … | grep '^## '`) + the
  "editing the .md is NOT ingestion" warning;
- **follow-up draft** and **execution/planner handoff** stages — the latter
  ADAPTED to Elliot's standing preference: do NOT auto-write tasks into the brain
  via `daily-task-manager`;
- merged triggers (also catches the old post-meeting-flow phrasings) + expanded
  tools (read/write/exec/message); migrated post-meeting-flow's `routing-eval.jsonl`
  fixtures into `meeting-ingestion/routing-eval.jsonl`.
**Also:** deleted the workspace-only custom skill `post-meeting-flow` (it was an
OpenClaw-local skill, NOT a gbrain-shipped file, so it is out of PATCH scope —
noted here only as context; nothing to reapply for it).
**Why:** one skill per meeting; the stock skill's fire-and-forget ingest had no
review checkpoint, no skim-ordered structure, and no follow-up/execution stages.
**Where:** the runtime copy is `~/.openclaw/workspace/skills/meeting-ingestion/`;
the gbrain bundle copy `skills/meeting-ingestion/` is kept byte-identical. An
upgrade overwrites the bundle copy — reapply this rewrite there (and re-sync the
workspace copy) after upgrading.
**How to recreate:** re-merge the post-meeting-flow stages (draft → review →
ingest+verify → enrich/propagate/timeline → follow-up → execution-without-brain-
writes) into `meeting-ingestion`, keeping all original enrichment guarantees, and
migrate the routing-eval fixtures. NOTE: post-meeting-flow was never committed to
any git repo and is now deleted, so its full behavior survives ONLY as what was
folded into `meeting-ingestion` v2.0.0 (this entry + the merged SKILL.md are the
reference) — there is no standalone copy to restore from.

> **Conflict-free customizations (no recreate entry needed).** The `gbrain tags`
> command (`src/commands/tags.ts` + minimal cli.ts wiring), the safe-upgrade
> system (`src/commands/upgrade-bunlink.ts`, the `upgrade.ts` bun-link hook, the
> `skills/upgrade-resolve` skill), and the `skills/conventions/tagging.md`
> convention are also permanent customizations — but they live in **new/standalone
> files** that replay cleanly on rebase and don't need intent-recreation. Listed
> for awareness only; if their thin wiring ever conflicts, treat as Section A.

═══════════════════════════════════════════════════════════════════════
# Section B — Ephemeral Bug Fixes (carry ONLY until upstream fixes; then DROP)
═══════════════════════════════════════════════════════════════════════

## B1. MODIFIED gbrain source — `src/core/ai/gateway.ts` (`instantiateEmbedding` openai-compatible branch)
**Status: ACTIVE** (as of 0.42.24.0 — upstream has NOT fixed this half).
**Upstream:** same issue family as garrytan/gbrain#1762. Upstream merged the
*cli.ts drain* half (see B2) as v0.42.20.0, but did **not** add any per-request
timeout to the embed path. This half is still ours alone.
**Drop-when:** upstream adds a wall-clock timeout to the openai-compatible embed
fetch. Check: `git show origin/master:src/core/ai/gateway.ts | grep -E
"withEmbedFetchTimeout|AbortSignal.timeout.*EMBED|EMBED_FETCH_TIMEOUT"`. If a
per-embed-request timeout appears upstream → retire this entry, drop our patch.
(2026-06-04: 0 matches upstream → KEEP.)
**Change:** added a per-request wall-clock timeout to every embedding HTTP
request on the `openai-compatible` recipe path (ZeroEntropy / Voyage / generic),
which this brain uses (`zeroentropyai:zembed-1`).
**Root cause (separate latent hang from B2, both surface as a pinned PGLite
lock):** plain `fetch` (Bun/Node) has NO default request timeout, and the AI SDK's
`maxRetries` only fires on a SETTLED error response — a half-open / stalled provider
socket never settles, so the `await` inside `embedBatch` never resolves. Embedding
runs **inline and awaited inside `put_page`/`importFromContent`
(import-file.ts ~587/1017) BEFORE `engine.disconnect()`**, so a stalled embed
socket hangs `gbrain capture` mid-work with the lock still held — wedging the brain
exactly like B2 but for a different reason (hang DURING work vs hang ON exit).
**Edit made:** `withEmbedFetchTimeout(inner?)` wraps the recipe's fetch (or the
default) so every embed request carries an `AbortSignal.timeout(60_000)`, composed
via `AbortSignal.any([init.signal, timeout])` so it never clobbers a caller/SDK
abort signal. Wired unconditionally into the `openai-compatible` branch (so
ZeroEntropy's `zeroEntropyCompatFetch` and Voyage's `voyageCompatFetch` are both
wrapped). 60s is generous vs. observed 2–7s embed latencies while still bounding
lock-hold.
**Verification:** with a stalled `fetch`, the pre-fix gateway `embed()` hangs
indefinitely (still spinning at 5s); the post-fix path rejects at the timeout
(unit-tested at 300ms/2s scaled copies → `AITransientError`), composes with a
caller signal (caller wins if earlier), and passes a normal fast response through
untouched.
**Why:** bounds the embed await so a flaky provider socket can't hang capture (and
hold the lock) forever. Defense for the DURING-work hang; B2 fixed the ON-EXIT hang.
**How to recreate:** add `withEmbedFetchTimeout()` (AbortSignal.timeout +
AbortSignal.any compose) and wrap the `openai-compatible` recipe's fetch with it
in `instantiateEmbedding`, passing `fetch: fetchWrapper` unconditionally to
`createOpenAICompatible`.

## B2. MODIFIED gbrain source — `src/cli.ts` (`handleCliOnly` finally)
**Status: RETIRED 2026-06-04 — upstream merged the equivalent fix. DO NOT re-apply.**
**Upstream:** garrytan/gbrain#1762 (Elliot's report). Merged upstream as
**v0.42.20.0** — the new `cli.ts` `handleCliOnly` finally now calls
`drainAllBackgroundWorkForCliExit()` (a generalized drain-before-disconnect) +
keeps the force-exit defense. That is a superset of our fix. On the 2026-06-04
upgrade to 0.42.24.0, our two cli.ts commits (`bd9aa1b7` force-exit, `1883a327`
drain) correctly LOST the rebase conflict to upstream; we keep upstream's.
**Drop-when:** SATISFIED — upstream `cli.ts` contains `drainAllBackgroundWorkForCliExit`
before `engine.disconnect()`. Verify: `grep -n drainAllBackgroundWorkForCliExit
src/cli.ts`. Our patch is obsolete; re-applying it would create a conflicting
second drain. (History below kept for reference only.)
**Change (historical):** `gbrain capture` on a **multi-chunk page** finished its
work but then **never exited**, pinning PGLite's single-writer lock so every later
gbrain command failed "Timed out waiting for PGLite lock" until SIGKILLed.
**TRUE root cause (proven 2026-06-02, MARK probes + /proc CPU sampling — see
memory/2026-06-02.md):** `put_page` (operations.ts ~875) fires a fire-and-forget
`facts:absorb` Haiku job into the bounded `FactsQueue` AFTER printing the receipt.
On a multi-chunk page that job is still in flight when `handleCliOnly`'s finally
tears the engine down; `engine.disconnect()` nulls `_db` out from under it, the
job's error path re-pumps the queue via `queueMicrotask`, and that microtask storm
interleaving with PGLite's WASM pump spins `db.close()` into a 100%-CPU userspace
busy-loop that never returns — so the unref'd 10s force-exit timer can't fire and
the lock is never released.
**Edit made (historical):** in `handleCliOnly`'s finally, before disconnect, DRAIN
the fire-and-forget work (`awaitPendingLastRetrievedWrites()` then
`getFactsQueue().drainPending({ timeout: 2000 })`) for non-`serve` commands;
force-exit kept as defense-in-depth.
**Why retired:** upstream's `drainAllBackgroundWorkForCliExit()` is the same
causal fix, generalized and authoritative. Two drains = conflicting solutions to
one problem; trust upstream's.
