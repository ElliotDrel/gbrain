# PATCH.md — gbrain fork patch manifest

**Purpose.** Manifest of changes this private fork carries on top of upstream
`garrytan/gbrain`, so they can be re-applied (or correctly *dropped*) after an
upgrade. Only gbrain-owned files that an update can overwrite belong here —
NOT plain OpenClaw-local additions (custom workspace skills, conventions,
workspace scripts) unless they've been moved upstream into gbrain itself.

No code snippets — only intent, scope, and enough pointers to rebuild quickly.

Last updated: 2026-06-17 (on gbrain 0.42.47.0). Upgrade audit this date:
rebased the 87 fork patches from `0.42.42.0` onto upstream `origin/master`
`0.42.47.0` (came in: 0.42.43 push-based context #2095 + teardown-exit #2084,
0.42.44 docs, 0.42.45 delta-aware sync cost estimator #2139, 0.42.46 federated
by-slug read scope #2200, 0.42.47 brain-resident skillpacks + advisor #2180).
Conflicts (all resolved keep-ours / keep-both): `gateway.ts` (B1 surface —
kept upstream's `openAICompatAsymmetricFetch`, then B1 cleanly RETIRED later in
the stack), `cli.ts` CLI_ONLY set (union: upstream `advisor`/`watch` + our
`reference`), `KEY_FILES.md` (kept our reference-flag bullet + upstream's
5-sink background-work bullet), `commands/sync.ts` (kept BOTH upstream
`--skip-failed` per-source ack + our B4 `--facts-backfill`). Section B audit
vs 0.42.47.0: **B1, B2 retired** (upstream shipped equivalents); **B3, B4, B5,
B6, B7 still ACTIVE** — none conflicted except B4 (resolved keep-both), and the
B5/B6/B3 regression tests (entity-resolve, import-metafile-skip, fix-wave-
structural) pass on the rebased tree, so all five remain present and still
needed. Section A customizations survived intact. typecheck clean; pushed to
fork `master` (b363e340 -> e2c64048, force-with-lease).

Prior sweep: 2026-06-12 (on 0.42.40.0) — added A4–A7 (plain-bullet timeline
convention, reference-entity flag, conversation body reader, ingest
social-routing); re-verified A1–A3.

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

## A4. Plain-bullet timeline/back-link convention — 5 stock skills + `src/commands/extract.ts`
**Change:** standardized the brain's timeline/back-link line format on a **plain
bullet** — `- YYYY-MM-DD — Summary` — replacing upstream's bold-pipe shape
(`- **YYYY-MM-DD** | Summary`). This is a deliberate convention choice, not a bug
fix, so it persists.
**Edit made (two halves that must stay in sync):**
- **Skill templates** rewritten to emit the plain-bullet shape in their Timeline
  and back-link examples: `enrich` (person + company templates + a new "use this
  exact shape, the extractor parses it" callout), `idea-ingest`, `maintain`,
  `signal-detector`, `voice-note-ingest`.
- **`src/commands/extract.ts` `extractTimelineFromContent`** taught a **Format 3**
  plain-bullet regex (`^-\s+(\d{4}-\d{2}-\d{2})\s*[—–-]\s*(.+)$`, line-anchored,
  `gm`) so the extractor actually recognizes what the skills now write. Without
  this half, every brain-authored timeline entry is invisible to extraction and
  `timeline_coverage` sits at 0%. The Format-1 bold pattern still matches, so the
  two never double-count (a `*` follows the bullet in Format 1, not a digit).
**Why:** one canonical timeline format end-to-end; the skill format and the
extractor regex are a matched pair — change one, change both.
**How to recreate:** re-apply the plain-bullet template edits in those 5 skills
AND re-add the Format-3 plain-bullet branch to `extractTimelineFromContent`. Stock
`maintain` also documents `- **DATE** | …` / `### DATE — Title` as the only parsed
formats; keep the "plain-bullet is canonical, bold-pipe is legacy" wording there.

## A5. Reference-entity flag (`reference: true`) — new files + inline coverage exclusions
**Change:** added a `reference: true` frontmatter flag (set via `gbrain reference
<slug>`) for person/company pages the user only reads ABOUT (book authors,
historical figures, companies discussed in an article) — they stay fully typed,
searchable, enrichable, and linkable but are **exempt from entity coverage
nudges** (timeline/links), which don't apply to figures with no dated history in
the user's own life.
**Edit made:**
- **New files (conflict-free):** `src/core/reference-flag.ts` (`referenceExclusionSql()`
  helper), `src/commands/reference.ts` (`gbrain reference` command),
  `skills/conventions/reference-entities.md` (the convention).
- **Inline edits to stock files (THESE conflict on upgrade — the real reason this
  entry exists):**
  - `src/cli.ts` — add `'reference'` to `CLI_ONLY` + a `case 'reference'` dispatch
    in `handleCliOnly`.
  - `src/core/onboard/checks.ts` — `AND ${referenceExclusionSql(...)}` in both
    `checkEntityLinkCoverage` and `checkTimelineCoverage` (total + sample queries).
  - `src/core/onboard/init-nudge.ts` — same exclusion in the 3 nudge count queries.
  - `src/core/pglite-engine.ts` — exclusion in the doctor health `entity_pages` CTE.
  - `src/core/postgres-engine.ts` — same exclusion, but **inlined as raw SQL**
    (`(frontmatter->>'reference') IS DISTINCT FROM 'true'`) because postgres.js
    tagged-template `${}` is a bound param, not raw SQL — cannot call the helper
    here; keep it in sync with `referenceExclusionSql()` by hand.
- **Skill guidance** added to `enrich`, `article-enrichment`, `book-mirror`, and
  `maintain` (mint reference pages for read-about figures; default OFF for real
  contacts; `maintain` notes reference pages are exempt from coverage metrics).
**Why:** book/article imports were minting un-dated entity pages that dragged
`link_coverage`/`timeline_coverage` toward 0% and triggered endless nudges.
**How to recreate:** keep the 3 new files, then re-thread `referenceExclusionSql()`
into every coverage/health query above (and the hand-inlined raw-SQL copy in
`postgres-engine.ts`), re-wire the `reference` command in `cli.ts`, and re-add the
4 skills' guidance. The inline SQL exclusions are what an upgrade overwrites.

## A6. Conversation body reader + `speaker-letter-no-time` pattern — new file + inline swaps
**Change:** conversation/meeting fact-extraction now reads the **`raw_transcript`
sidecar** (the real turn-by-turn transcript) when present, instead of only
`compiled_truth + timeline` (which on meeting pages is just the human summary), and
added a built-in parser pattern for this workspace's `Speaker A: …` / `Speaker B: …`
raw transcript shape.
**Edit made:**
- **New file (conflict-free):** `src/core/conversation-parser/body.ts`
  (`readConversationBodyForParsing(engine, page)` — prefers `frontmatter.raw_transcript`
  sidecar, falls back to `compiled_truth + timeline`).
- **Inline edits to stock files (conflict on upgrade):**
  - `src/commands/conversation-parser.ts`, `src/commands/doctor.ts`, and
    `src/commands/extract-conversation-facts.ts` all swapped their ad-hoc
    `compiled_truth + timeline` body concatenation for `readConversationBodyForParsing`
    (extract-conversation-facts.ts also deleted its now-dead local `readPageBody`).
  - `src/core/conversation-parser/builtins.ts` — added the `speaker-letter-no-time`
    built-in pattern (`^(Speaker [A-Z0-9]+):\s*(.*)$`, `quick_reject /^Speaker /`,
    frontmatter date source) for Fathom/phone-call raw transcripts.
**Why:** meeting pages store the transcript in a `.raw/` sidecar and the summary in
`compiled_truth`; reading only the latter silently dropped the actual conversation
from fact extraction, and the plain `Speaker A:` shape had no matching pattern.
**How to recreate:** keep `body.ts`, re-point the 3 command files at
`readConversationBodyForParsing`, and re-add the `speaker-letter-no-time` pattern to
`builtins.ts`. NOTE: an earlier `me-them-no-time` pattern was added then **reverted**
(`ecd580c3`) — do NOT re-add it; only `speaker-letter-no-time` is live.

## A7. MODIFIED stock skill — `skills/ingest/SKILL.md`
**Change:** the audio/video ingest phase now routes social/video URLs through
`media-ingest`'s integrated provider (Supadata) path **first**, so transcript +
metadata land together in one raw provenance file before the generic
transcript-and-analyze steps run (the remaining steps were renumbered to fit).
**Why:** keeps social/video provenance consistent with the `media-ingest` pipeline
instead of a parallel ad-hoc transcript fetch.
**How to recreate:** in the audio/video section, prepend the "route social/video
through media-ingest's Supadata path first" step and renumber the following steps.

## A8. MODIFIED context-engine plugin — conform to OpenClaw 2026.6.1 plugin contract
**Files:** `openclaw.plugin.json` + `src/openclaw-context-engine.ts`.
**Change (three coordinated edits):**
1. `openclaw.plugin.json`: add top-level `"id": "gbrain"` and `"kind": "context-engine"`.
2. `src/openclaw-context-engine.ts`: the default-export entry now sets `id: 'gbrain'`
   (was `'gbrain-context-engine'` — must MATCH the manifest id) and adds
   `kind: 'context-engine'` (+ the field on the `PluginEntry` interface).
**Why (verified against host 2026.6.1 `dist/`):**
- Manifest needs a top-level `id` or config validation fails ("plugin manifest requires id"),
  breaking the gateway on restart. Stock gbrain ships only `name`.
- `kind: "context-engine"` is the GATE: `dist/api-builder` wires
  `registerContextEngine: handlers.registerContextEngine ?? noopRegisterContextEngine`
  — without a declared `kind`, the plugin's `register()` gets the **no-op**, so the engine
  never registers and the plugin shows as "non-capability" (`openclaw plugins inspect`).
- The slot value is matched against the **plugin id**, not the engine id:
  `dist/...shouldConsiderForGatewayStartup`: `contextEngineSlotStartupPluginId === plugin.pluginId`.
  So host config must be `plugins.slots.contextEngine: "gbrain"` (the plugin id), NOT
  `"gbrain-context"` (the ENGINE_ID) — gbrain's own `docs/guides/push-context.md` documents the
  engine-id value, which is wrong for the 2026.6.1 slot contract. (Host-config detail, not a
  fork file — lives in `~/.openclaw/openclaw.json`; recorded here so the next upgrade knows.)
Added 2026-06-17 to enable the push-context Retrieval Reflex deterministic layer. Strong
upstream candidate (gbrain's context-engine plugin packaging is stale vs current OpenClaw).
**How to recreate:** in `openclaw.plugin.json` add `"id": "gbrain"` + `"kind": "context-engine"`;
in the entry default export set `id: 'gbrain'` + `kind: 'context-engine'`; set the host's
`plugins.slots.contextEngine` to the plugin id `"gbrain"`.

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
**Status: RETIRED 2026-06-14 — upstream shipped the equivalent embed timeout. DO NOT re-apply.**
**Upstream:** same issue family as garrytan/gbrain#1762. Upstream merged the
*cli.ts drain* half (see B2) as v0.42.20.0, and as of **v0.42.42.0** (the merge that
"incorporates + hardens PR #1763, @ElliotDrel") it now also bounds the embed path:
`gateway.ts` defines `AI_EMBED_TIMEOUT_MS` (60s, env `GBRAIN_AI_EMBED_TIMEOUT_MS`)
and `withDefaultTimeout(caller, ms)` (AbortSignal.timeout composed with the caller
signal via the SDK), applied at the per-sub-batch embed call
(`abortSignal: withDefaultTimeout(opts?.abortSignal, AI_EMBED_TIMEOUT_MS)`). That is
a superset of our fetch-level wrapper — same 60s wall-clock bound, threaded through
the AI SDK abortSignal instead of wrapping `fetch`.
**Drop-when:** SATISFIED — upstream adds a wall-clock timeout to the embed path.
Verify: `git show origin/master:src/core/ai/gateway.ts | grep -E
"AI_EMBED_TIMEOUT_MS|withDefaultTimeout"`. On the 2026-06-14 upgrade to 0.42.42.0
the `withEmbedFetchTimeout` wrapper (function def + the one `openai-compatible`
call-site wrap) was REMOVED and the embed instantiation block reverted to match
upstream byte-for-byte (incl. the `...(fetchWrapper ? { fetch: fetchWrapper } : {})`
spread). Re-applying our wrapper would just double-bound the same request.
(History below kept for reference only.)
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

## B3. MODIFIED gbrain source — `src/commands/doctor.ts` + `src/core/onboard/checks.ts` (onboard-check pool deadlock)
**Status: ACTIVE** (added 2026-06-13, commit `7c734c4d`; upstream has NOT fixed — verified on 0.42.42.0).
**Upstream:** none. `garrytan/gbrain` runs PGLite (no connection pool), so the
deadlock is invisible there; this only bites a remote pooled engine (Postgres/
Supabase) with a small pool. (This brain ran `GBRAIN_POOL_SIZE=2` when this patch
was added; raised to **10** on 2026-06-14 -- the real fix was serializing the
checks below, NOT the pool size, so this patch stays ACTIVE regardless of pool.)
**Drop-when:** upstream runs onboard checks sequentially (or pool-aware) AND bounds
the doctor call with a timeout. Check: `git show origin/master:src/core/onboard/checks.ts
| grep -nE "for .*await|sequential|POOL"` and `git show origin/master:src/commands/doctor.ts
| grep -n "runAllOnboardChecks"` — if the `Promise.all` fan-out is gone / bounded
upstream → retire. (2026-06-14: upstream still fans out via `Promise.all`, no timeout → KEEP.)
**Change:** `runAllOnboardChecks` ran its 7 checks via `Promise.all`; each acquires
>=1 DB connection, so on a small remote pool the concurrent acquisitions exhaust the
pool and deadlock indefinitely (>22min observed). doctor also called it without the
AbortSignal timeout its own doc comment requires.
**Edit made:** run the onboard checks **sequentially** (so in-flight connections fit
any pool size) + bound the doctor call with a **30s** defensive timeout in `doctor.ts`,
falling through with a warn instead of hanging. Full doctor ~10s (verified at
pool=2 when added; still fine at the current pool=10).
**Why:** a single small-pool remote engine must not be able to wedge `gbrain doctor`.
**How to recreate:** make `runAllOnboardChecks` iterate `for ... await` instead of
`Promise.all`, and wrap its call in `doctor.ts` with a 30s `AbortSignal.timeout`.

## B4. MODIFIED gbrain source — `src/commands/sync.ts` (facts backstop: `--facts-inline` + `--facts-backfill`)
**Status: ACTIVE** (added 2026-06-14; upstream has NOT fixed — the queue design assumes a long-lived process).
**Upstream:** none. The facts:absorb pipeline runs as fire-and-forget via `FactsQueue`
(`src/core/facts/queue.ts`); on CLI exit, background-work teardown gives it only a short
drain budget. An ~8s Sonnet extraction never survives that, so on a **CLI-per-command
install** (this brain — no long-lived `serve`/autopilot draining the queue) EVERY facts
job dies on exit and the `facts` table stays empty forever. Confirmed live 2026-06-14:
0 facts rows ever on Supabase, 35 `facts:absorb` pipeline_error rows in 24h (all the
abort-on-exit). garrytan's reference setup runs autopilot/serve, so the queue drains
there and the bug is invisible upstream.
**Drop-when:** upstream makes the facts backstop synchronous on the sync/CLI path (e.g.
a `mode:'inline'` default for sync, or a guaranteed post-command drain that awaits
in-flight extractions). Check: `git show origin/master:src/commands/sync.ts | grep -n
"mode: 'queue'\|factsInline"` — if sync no longer hard-codes `mode:'queue'` OR teardown
awaits the facts queue to completion → retire.
**Change:** added (a) `--facts-inline` — flips the sync facts backstop from `mode:'queue'`
to `mode:'inline'` (blocking) so the extract→resolve→dedup→fence pipeline completes
before process exit; threaded `factsInline` through `SyncOpts` + all 3 opts constructions
+ `syncOneSource`. Wired into the 15-min Live Sync cron (tiny deltas → 1-2 blocking
Sonnet calls, well inside the 300s budget). And (b) `--facts-backfill [--limit N]` — a
one-time path (`runFactsBackfill`) that runs the inline pipeline over every eligible
already-ingested page (paginates past listPages' default LIMIT 100), to populate the
backlog the queue never filled. Idempotent (dedup @ 0.95). Backfill 2026-06-14 inserted
48 facts from 50 eligible pages, 0 failures.
**Why:** a CLI-per-command brain must actually persist facts; the queue path silently
drops 100% of them here.
**How to recreate:** in sync.ts add `factsInline?: boolean` to `SyncOpts`; parse
`--facts-inline`/`--facts-backfill`; set the backstop call's `mode` to inline when
factsInline; add `runFactsBackfill` (listPages-paginated, eligibility-filtered, inline
`runFactsBackstop` per page at concurrency 4) + a `--facts-backfill` branch in `runSync`.
**Note:** see B5 — the unprefixed/mis-prefixed-slug routing (`elliot-drel`,
`people-elliot-drel`) was a real resolver bug, fixed there.

## B5. MODIFIED gbrain source — `src/core/entities/resolve.ts` (resolver fallback mangles prefixed slugs)
**Status: ACTIVE** (added 2026-06-14; upstream has NOT fixed).
**Upstream:** none observed. `resolveEntitySlug` / `resolveEntitySlugWithSource` end with a
plain `slugify(trimmed)` fallback. When the extractor emits an already-prefixed slug
(`people/elliot-drel`) that doesn't exact/fuzzy-match an existing page, `slugify` collapses
the `/` to `-` → `people-elliot-drel`. That mangled string (a) can never match the real
`people/elliot-drel` page and (b) is unprefixed, so the facts fence-write stub-guard
refuses it → the fact silently drops to the DB-only path instead of being fenced onto a
person/company page. Found 2026-06-14: 14 of 48 backfilled facts (10 about Elliot, who had
no self-page) were DB-only for this reason.
**Drop-when:** upstream's resolver preserves a directory prefix in its fallback. Check:
`git show origin/master:src/core/entities/resolve.ts | grep -n "slugifyPreservingPrefix\|indexOf('/')"`
— if the fallback splits on the first slash / preserves the prefix → retire.
**Change:** added `slugifyPreservingPrefix(raw)` — splits on the FIRST `/`, slugifies each
side, rejoins with `/` (so `people/Elliot Drel` → `people/elliot-drel`, a valid fenceable
slug; no slash → unchanged flat `slugify`). Used in the step-4 fallback of BOTH
`resolveEntitySlug` and `resolveEntitySlugWithSource`. The exported `slugify` keeps its flat
contract for other callers.
**Why:** a correctly-prefixed entity slug from the extractor must stay fenceable, not get
mangled into a DB-only orphan.
**How to recreate:** add the `slugifyPreservingPrefix` export and call it instead of
`slugify` in the two resolver fallbacks. Tests: `test/entity-resolve.test.ts` →
`describe('slugifyPreservingPrefix')`.
**Companion content fix (not code):** created the 3 missing target pages
`people/elliot-drel` (the owner had no self-page), `people/harsh-vyas`, `people/nishant-nair`
(both were dangling backlinks from their meeting notes), then re-ran `--facts-backfill`.
Result: 62 facts, **0 orphan entity_slugs** (every fact resolves to a real page).

## B6. MODIFIED gbrain source — `src/commands/import.ts` (`isCollectibleForWalker` skips metafiles)
**Status: ACTIVE** (added 2026-06-15; upstream has NOT fixed).
**Upstream:** none observed. `sync` filters files through `isSyncable` → `SYNC_SKIP_FILES`
(`schema.md`, `index.md`, `log.md`, `README.md`), but the bulk-import walker
(`collectSyncableFiles` → `isCollectibleForWalker`) filtered ONLY by extension
(`isMarkdownFilePath`). So `gbrain import <dir>` — and any directory-restore reconciliation
pass — imports every metafile as a page that incremental sync would never index.
**How it bit us (root cause of the "readme ghost pages"):** the 2026-06-13 PGLite→Supabase
migration row-copied the 167 real pages, then ran a directory-import over `/home/supe/brain`
to backfill anything missing. The only files "missing" were the 22 metafiles (19 directory
`README.md` + `index.md` + `log.md` + `schema.md`) — because `sync` had always skipped them,
they were never in PGLite. The import created all 22 as pages, titled by their folder
("People", "Companies", …). Those index-titled pages then **trigram-corrupt fuzzy entity
resolution**: any `people/X` slug fuzzy-matches the "People" page (this is how Jon Clem's fact
mis-resolved onto `people/readme` — see B5 cleanup). `ingest_log` proof: one row at
`2026-06-13T17:22:54Z`, `source_type=directory`, `source_ref=/home/supe/brain`,
`summary="Imported 22 pages, 155 skipped, 22 chunks"`, `pages_updated` = exactly those 22.
**Drop-when:** upstream funnels the import walker through `isSyncable` / applies
`SYNC_SKIP_FILES`. Check:
`git show origin/master:src/commands/import.ts | grep -n "SYNC_SKIP_FILES\|isSyncable"` — if
`isCollectibleForWalker` (or its replacement) excludes the metafile basenames → retire.
**Change:** import `SYNC_SKIP_FILES` from `core/sync.ts`; at the top of
`isCollectibleForWalker`, reject any path whose basename is in `SYNC_SKIP_FILES` before the
strategy switch. Single chokepoint for both the git-fast-path and the FS-walk, so import and
sync now agree on what is a page.
**Why:** bulk import and incremental sync must share one definition of "is this a page,"
or a first-import/migration silently seeds metafile ghosts that poison resolution.
**How to recreate:** add `SYNC_SKIP_FILES` to the `core/sync.ts` import; add the basename
guard in `isCollectibleForWalker`. Tests: `test/import-metafile-skip.test.ts` (FS-walk +
git-fast-path both exclude README/index/log/schema, keep real pages).
**Companion data cleanup (not code):** soft-deleted all 22 metafile ghost pages from the live
Supabase engine via `gbrain delete` (recoverable). Verified 0 facts / 0 inbound / 0 outbound
links on them first; 208 live pages remain, 0 metafile ghosts.

## B7. MODIFIED gbrain source — `src/core/sync.ts` (`SYNC_SKIP_FILES` adds `RESOLVER.md`)
**Status: ACTIVE** (added 2026-06-15; upstream has NOT fixed).
**Upstream:** none observed. `SYNC_SKIP_FILES` skips the structural metafiles
(`schema.md`, `index.md`, `log.md`, `README.md`) but OMITS `RESOLVER.md` — even though the
recommended-schema docs explicitly group `RESOLVER.md` WITH those siblings as a structural
config document, not searchable content: the `brain/` tree lists "`RESOLVER.md` — master
decision tree for filing" alongside `schema.md`/`index.md`/`log.md`, and the architecture
section calls the schema "a document … plus `schema.md` and `RESOLVER.md` … that tells the
agent how the brain is structured" (`docs/GBRAIN_RECOMMENDED_SCHEMA.md`). So `RESOLVER.md` is
a routing/config metafile by the project's OWN docs, but was the lone structural sibling
missing from the skip list.
**How it bit us:** the brain's top-level `RESOLVER.md` got synced as a content page
(`slug=resolver`, title "Brain Resolver", 1 content chunk) and showed up as a searchable
result. Surfaced in the 2026-06-15 2-day audit as judgment-call #1 ("RESOLVER.md still
indexed as a searchable brain page"). Elliot's call: "check gbrain docs and do whatever they
say" → docs say it's structural → exclude it.
**Drop-when:** upstream adds `RESOLVER.md` to `SYNC_SKIP_FILES`. Check:
`git show origin/master:src/core/sync.ts | grep -n "RESOLVER.md"` — if present in
`SYNC_SKIP_FILES` → retire.
**Change:** append `'RESOLVER.md'` to `SYNC_SKIP_FILES` in `src/core/sync.ts`. One chokepoint:
`classifySync` (so `isSyncable`/`unsyncableReason`) AND B6's `isCollectibleForWalker` both
read this list, so sync + import now both treat `RESOLVER.md` as a metafile.
**Why:** the docs designate `RESOLVER.md` a structural config document on par with
`schema.md`; indexing it as content pollutes search and (like other folder-titled metafiles,
see B6) risks fuzzy-resolution noise.
**How to recreate:** add `'RESOLVER.md'` to the `SYNC_SKIP_FILES` array + update its doc
comment. Tests: `test/sync-isSyncable-shape.test.ts` (RESOLVER.md anywhere → `'metafile'`;
canonical-set assertion) + `test/import-metafile-skip.test.ts` (FS-walk + git-fast-path both
exclude RESOLVER.md).
**Companion data cleanup (not code):** soft-deleted the live `resolver` page via
`gbrain delete resolver` (recoverable 72h). Verified 0 facts / 0 links / 0 page_links first;
206 live pages remain, 0 chunks for `resolver`, absent from search.
