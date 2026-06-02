# PATCH.md — Overwrite-prone gbrain changes only

**Purpose.** This manifest should include only changes to actual gbrain-owned
files that are likely to be overwritten by an update. It should NOT include
plain OpenClaw-local additions like new custom skills, tagging conventions, or
workspace scripts unless those are moved upstream into gbrain itself.

No code snippets here — only intent, scope, and enough pointers for a capable
developer to rebuild the changes quickly after an update.

Last updated: 2026-06-01.

---

## 1. MODIFIED stock skill — `skills/media-ingest/SKILL.md`
**Change:** Phase 3's page template originally had **no frontmatter and no
tags**, so pages shipped untagged (a real retrieval miss — caught 2026-06-01).
**Edit made:** added a YAML frontmatter block to the template (`type`, `title`,
mandatory `tags:` guidance with a prefer-existing reminder) and an **Author:**
line. The rule lives in the template itself — deliberately not duplicated as a
separate skill-body instruction.
**Why:** untagged pages don't connect; tags are the graph's edges.
**How to recreate:** in Phase 3 ("Create brain page"), prepend frontmatter with a
mandatory tags block to the template and add the tagging-convention callout.

## 2. MODIFIED gbrain source — `src/commands/files.ts`
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

## 3. MODIFIED gbrain source — `src/cli.ts` (`handleCliOnly` finally)
**Change:** bug fix — `gbrain capture` on a **multi-chunk page** finished its
work (receipt printed, page durably written) but then **never exited**, pinning
PGLite's single-writer lock so every later gbrain command failed "Timed out
waiting for PGLite lock" until the zombie was SIGKILLed.

**TRUE root cause (proven 2026-06-02 with MARK probes + /proc CPU sampling — see
memory/2026-06-02.md):** NOT the force-exit gap, and NOT the per-chunk Haiku
synopsis (that's downgraded to title-tier inline at import-file.ts:575, never runs
in capture). The real cause: `put_page` (operations.ts ~875) fires a
**fire-and-forget facts:absorb job into the bounded `FactsQueue`** (mode:`queue`)
AFTER printing the receipt. On a multi-chunk page that in-flight Haiku job is still
running when `handleCliOnly`'s finally tears the engine down. `handleCliOnly`,
unlike the op-dispatch finally (cli.ts ~290-317), did **NOT drain that queue
before disconnect**. `engine.disconnect()` nulled `_db` out from under the job; the
job's "PGLite not connected" error path re-pumps the queue via `queueMicrotask`,
and that microtask storm interleaving with PGLite's WASM message pump spun
`db.close()` into a **100%-CPU userspace busy-loop that never returns** (state R,
utime climbing; in isolation `db.close()` returns in ~9ms). The previously-committed
force-exit safety net (the unref'd 10s `setTimeout` → `process.exit(0)`) **cannot
fire** here: a same-thread timer needs an event-loop turn the busy WASM call never
yields (a Worker-thread watchdog can't preempt it either). And because
`disconnect()` releases the lock only in its `finally` AFTER `db.close()`, the lock
is never released, stays pinned, and wedges the brain.

**Edit made (the REAL fix):**
`src/cli.ts` `handleCliOnly` finally: before `engine.disconnect()`, DRAIN the
fire-and-forget work — `awaitPendingLastRetrievedWrites()` then
`getFactsQueue().drainPending({ timeout: 2000 })` — for non-`serve` commands.
The Haiku job then finishes cleanly against a still-live engine and `db.close()`
returns in ~10ms instead of busy-looping. This mirrors the op-dispatch finally
exactly. The force-exit hard-deadline + post-disconnect `process.exit(0)` (from
the original bd9aa1b7) is KEPT as defense-in-depth. Also removed the temporary
`MARK` debug probes.

NOTE: `PGLiteEngine.disconnect()` was deliberately left UNCHANGED (close-then-
release ordering). An earlier idea to release the lock before `db.close()` as
extra defense was rejected: `test/pglite-engine-disconnect.serial.test.ts` pins
the close-before-release invariant on purpose (a sibling must not acquire the lock
and connect to a still-closing brain). The drain fixes the busy-loop at its
source, so close returns promptly and the reorder is unnecessary.

**Why:** the drain removes the busy-loop at its source, so the CLI exits cleanly
without relying on a force-kill (which provably can't fire against a WASM
busy-loop).
**How to recreate:** in `handleCliOnly`'s finally, add the lastRetrieved +
facts-queue drain (both best-effort/try-catch, 2s facts timeout) before
`if (command !== 'serve') await engine.disconnect()`, keeping the
`shouldForceExitAfterMain()` unref'd-timer + post-disconnect `process.exit(0)`.
**Related (item #5):** `src/core/ai/gateway.ts` adds a per-request embed fetch
timeout — a separate latent hang (stalled embedding socket DURING capture, before
disconnect) that would also pin the lock. Kept as defense for that distinct case.
**Upstream:** symptom reported at garrytan/gbrain#1762; this hits anyone on
tokenmax ingesting multi-chunk pages. Original force-exit-only attempt: `bd9aa1b7`
(insufficient — symptom-level). Real fix commit: see git log on `/home/supe/gbrain`
master.

## 4. MODIFIED stock skill — `skills/meeting-ingestion/SKILL.md` (→ v2.0.0)
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

## 5. MODIFIED gbrain source — `src/core/ai/gateway.ts` (`instantiateEmbedding` openai-compatible branch)
**Change:** added a per-request wall-clock timeout to every embedding HTTP
request on the `openai-compatible` recipe path (ZeroEntropy / Voyage / generic),
which this brain uses (`zeroentropyai:zembed-1`).
**Root cause (separate latent hang from item #3, both surface as a pinned PGLite
lock):** plain `fetch` (Bun/Node) has NO default request timeout, and the AI SDK's
`maxRetries` only fires on a SETTLED error response — a half-open / stalled provider
socket never settles, so the `await` inside `embedBatch` never resolves. Embedding
runs **inline and awaited inside `put_page`/`importFromContent`
(import-file.ts ~587/1017) BEFORE `engine.disconnect()`**, so a stalled embed
socket hangs `gbrain capture` mid-work with the lock still held — wedging the brain
exactly like #3 but for a different reason (hang DURING work vs hang ON exit).
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
hold the lock) forever. Defense for the DURING-work hang; item #3 fixes the
ON-EXIT hang.
**How to recreate:** add `withEmbedFetchTimeout()` (AbortSignal.timeout +
AbortSignal.any compose) and wrap the `openai-compatible` recipe's fetch with it
in `instantiateEmbedding`, passing `fetch: fetchWrapper` unconditionally to
`createOpenAICompatible`.
**Upstream:** same issue family as garrytan/gbrain#1762.
