# Mode — Cross-Brain Meeting (one meeting → both brains)

Read this when a single meeting genuinely belongs in **two brains** (e.g. an
Elliot+Karthik call that's both a personal catch-up and a buildpurdue working
session, or a Sophia 1-on-1 that's mostly buildpurdue but also personal). This is a
**process mode**, not a notes variant — the notes variant (standard / leadership /
one-on-one) is chosen independently for *each* brain's page.

This mode only applies when the human signals the meeting spans both brains. The
auto-monitor (`skills/fathom-extract/scripts/poll.mjs`) never triggers it — it routes by title to a
single brain and cannot know a meeting is cross-brain.

## Principle: two pages, two lenses, one transcript

The brains are hard-isolated, so a cross-brain meeting becomes **two separate meeting
pages — one in each brain — each written through that brain's lens**, cross-linked, with
the same raw transcript copied into both sidecars. Rather than duplicating the full notes
into both, give each page *its* brain's material in detail and only summarize the other
with a pointer.

## Step A — pick the primary brain (by relevance, not by title)

The **primary** is whichever brain the conversation was *most about* — where the substance
and the time went. The **secondary** is the other one.

- Mostly buildpurdue, with some personal catch-up → **primary = buildpurdue**, secondary = personal.
- A personal conversation that only mentions buildpurdue once or twice → **primary = personal**, secondary = buildpurdue.

Judge by content, not the meeting title.

## Step B — ingest the PRIMARY brain (full normal flow, primary lens)

Run the complete meeting-ingestion flow (Step 0 through the final delivery) into the
**primary** brain as normal, with two scoping rules:

1. **Scope the notes to the primary brain's aspects.** Don't detail the secondary brain's
   material — reduce it to a one-line mention where needed.
2. Add a **companion pointer** near the top (blockquote under the header) naming the
   secondary brain's companion page, e.g.:
   `> This page is the buildpurdue lens of the call. Personal threads are in the companion page in the personal brain (meetings/<slug>).`

Pick the notes variant (standard / leadership / one-on-one) that fits the conversation —
independent of this mode. Finish the primary completely (draft → ingest → attendee
enrichment → entity propagation → timeline merge → follow-up draft → execution split →
commit & push) before touching the secondary — but **hold the single delivery message
until both brains are done** (see Delivery below). The one-checkpoint rule still applies:
do all the work on both brains first, then present once.

## Step C — second pass: ingest the SECONDARY brain (reread from scratch)

After the primary is fully done, **reread the raw transcript from scratch** — do not work
from the primary's notes; start clean so the secondary lens isn't anchored to the primary
framing. Then run the meeting-ingestion flow again into the **secondary** brain:

- Scope the notes to the **secondary** brain's aspects (the material the primary page
  deliberately skipped).
- Add the reciprocal companion pointer back to the primary page.
- Use whatever notes variant fits the secondary lens (it may differ from the primary's).
- Run its own attendee enrichment / entity propagation **within the secondary brain** (each
  brain has its own people/entity pages — never `--brain`, always the brain's own `$GB`).
- Draft the secondary brain's follow-up + run its execution split, and commit & push the
  secondary brain too.

## Delivery — one message, after both brains

Hold the single delivery (router `SKILL.md` Phase 10) until **both** brains are fully
done. Then present once: both ingest reports, both commit links, both brains'
ready-to-send follow-ups, and both execution-split summaries — followed by one invitation
to flag fixes. This keeps the one-checkpoint rule intact across the cross-brain mode. If
the user flags an issue on either brain, fix it in that brain, re-commit/push, and
re-deliver.

## Transcript handling (deterministic, both brains)

- The raw transcript is managed deterministically — fetched via `skills/fathom-extract/scripts/get.mjs`
  (and `get.mjs merge <id1> <id2> …` for a meeting Fathom split across recordings). Never
  hand-edit or hand-merge transcript content.
- Copy the **same** raw transcript file into **both** brains' `.raw/` sidecars verbatim
  (brains are isolated, so each needs its own copy). Each page's `raw_transcript:`
  frontmatter points at its own brain's copy.

## Checklist

- [ ] Primary chosen by relevance (where the substance was), not by title.
- [ ] Primary page: full flow, scoped to primary lens, companion pointer to secondary.
- [ ] Primary fully ingested + enriched before starting the secondary.
- [ ] Secondary: transcript reread from scratch (not derived from primary notes).
- [ ] Secondary page: scoped to secondary lens, reciprocal companion pointer.
- [ ] Same raw transcript copied into both sidecars; each `raw_transcript:` points local.
- [ ] Both pages cross-link; entity work done within each brain separately.
