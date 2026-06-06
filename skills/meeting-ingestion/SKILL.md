---
name: meeting-ingestion
version: 2.0.0
description: |
  Ingest meeting transcripts into brain pages with attendee enrichment, entity
  propagation, and timeline merge — AND run the full post-meeting flow: build a
  structured notes draft (Executive Summary → Key Takeaways → Key Decisions →
  Learnings or Useful Later → Action Items → Next Steps → Meeting Historical
  Breakdown), review it with the
  user before ingesting, then draft the follow-up and split out execution. A
  meeting is NOT fully ingested until the enrich skill has processed every entity.
triggers:
  - "meeting transcript"
  - "process this meeting"
  - "meeting notes"
  - meeting transcript received
  - "post-meeting flow"
  - "do the post-meeting flow"
  - "work through this meeting"
  - "process this meeting end to end"
  - "review takeaways then action items then follow-up"
  - "draft this meeting and do the follow-up flow"
  - "review meeting notes before ingesting"
  - "ingest this meeting"
  - "post meeting process"
  - "run my post meeting process"
  - "draft the follow-up"
  - "separate action items from next steps"
tools:
  - read
  - write
  - exec
  - message
  - search
  - query
  - get_page
  - put_page
  - add_link
  - add_timeline_entry
mutating: true
writes_pages: true
writes_to:
  - meetings/
  - people/
  - companies/
---

# Meeting Ingestion Skill

> **Filing rule:** Read `skills/_brain-filing-rules.md` before creating any new page.
>
> **v2.0.0 — merged skill.** This skill now covers the full post-meeting flow
> end to end, so you only invoke ONE skill per meeting. It still does everything
> the old meeting-ingestion did (attendee enrichment, entity propagation,
> timeline merge, back-links) AND adds the structured-notes + review-before-ingest
> + follow-up + execution behavior that used to live in the separate
> `post-meeting-flow` skill.

## Step 0 — pick the target brain (DO THIS FIRST)

This skill is **brain-agnostic**. Before anything else, decide **which brain this
meeting goes into, from the user's request**:

- User named it (e.g. "buildpurdue meeting") or the meeting clearly belongs to a
  specific brain → use that brain.
- Personal/EMS, or unspecified but clearly personal → the **default** brain.
- **If you genuinely can't tell which brain, ASK before writing anything.** Writing
  to the wrong brain is the one unrecoverable mistake in this flow.
- **If the meeting belongs in BOTH brains** (e.g. a call that's both a personal catch-up
  and a buildpurdue working session), STOP and read `cross-brain.md`, then follow it: pick
  the primary brain by relevance, ingest it fully, then do a second pass (reread the
  transcript from scratch) into the secondary brain. The auto-monitor never does this — it's
  manual-only.

Then bind two tokens and use them for the ENTIRE rest of this skill:

| Brain | `$BRAIN_DIR` (content root — every file path) | `$GB` (every brain command) |
|---|---|---|
| Personal/EMS (default) | `/home/supe/brain` | `gbrain` |
| buildpurdue | `/home/supe/buildpurdue-brain` | `scripts/bp-gbrain`  (= `GBRAIN_HOME=/home/supe/buildpurdue-brain gbrain`) |

Hard rules for the whole flow:
- Every file/page path = `$BRAIN_DIR/…`. Every brain command = `$GB …`.
- **Never run a bare `gbrain` for a non-default brain, and NEVER use `--brain`** — it
  silently writes to the personal brain (see `AGENTS.md` → "Brains (gbrain)").
- A new brain later → add a row to the table above. That's the only change needed.

Then pick the **notes variant** (the Phase-3 body structure) — independent of the brain:

| Notes variant | When | Body order |
|---|---|---|
| **standard** (default) | working/external/team meetings, calls, interviews | the Phase 3 template below |
| **leadership** | exec/strategy conversations — org-level: leaders deciding *how to run the org* (OKR/process/org syncs, board-ish calls) | `variants/leadership-notes.md` |
| **one-on-one** | person-level 1-on-1s — mentor/manager ↔ report/peer: coaching, checking in on someone's work, unblocking them, tactical working session | `variants/one-on-one-notes.md` |

Auto-detect **leadership** when the meeting is leaders talking about *how to run the
org* (decisions, goals, process, people) rather than executing tasks. Auto-detect
**one-on-one** when it's two people in a mentor/manager ↔ report/peer check-in —
coaching, reviewing one person's work, unblocking them — rather than an org-level
decision forum (a founder *coaching* a teammate on OKRs is one-on-one; founders
*deciding* the OKR process together is leadership). The user can override either way.
When a variant is selected, Phase 3 uses that variant's body order
instead of the standard one — everything else in the flow
is unchanged. (New notes variant later → add a `variants/<type>-notes.md` + a row here.)

## Contract

This skill guarantees:

- A structured meeting-notes **draft** is built before any ingestion.
- The notes begin with an `Executive Summary`, followed — in this fixed order —
  by `Key Takeaways`, then `Key Decisions` (if present), then `Learnings or
  Useful Later` (if present), then `Action Items`, then `Next Steps`. These
  skim-and-act sections sit at the top.
- The chronological `Meeting Historical Breakdown` is the last body section. If the page
  carries a `## Timeline` block (the append-only, `<!-- timeline -->`-marked
  entity timeline that tools edit deterministically), it stays at the very
  bottom, after the Meeting Historical Breakdown.
- `Action Items` (concrete things the user can directly do) are kept distinct
  from `Next Steps` (directional moves that aren't yet atomic tasks).
- `Action Items` ALSO includes a scan for **promises/commitments the user made to
  others** in the meeting; each such promise becomes its own action item, tagged
  `(promise)` so it's visually distinct from ordinary action items.
- The `Key Decisions` and `Learnings or Useful Later` sections are both optional
  — omit either entirely if nothing qualifies.
- The raw transcript is preserved in G-Brain via
  `$GB files upload-raw <file> --page meetings/<slug> --type transcript`, which
  creates a git-tracked `.raw/` sidecar next to the meeting page.
- The raw transcript is NOT a standalone body section. Provenance is a
  `raw_transcript:` pointer in the page **frontmatter** (a brain-relative path
  into the `.raw/` sidecar), optionally also a link under `See Also`. Never point
  at an inbound media temp path (`.openclaw/media/inbound/...`).
- The draft is **shown to the user for review before ingestion happens**, and the
  agent iterates until the user is satisfied. Ingestion happens only after approval.
- EVERY attendee gets a people page (created or updated).
- EVERY company/project discussed gets entity propagation.
- Timeline entries on ALL mentioned entities (timeline merge).
- A meeting is NOT fully ingested until enrich runs for every entity.
- Back-links created bidirectionally.
- The situation-specific deliverable (follow-up + execution for personal, or the
  team recap for buildpurdue — see Phase 9 and the `variants/` files) is produced
  **separately, after** the notes are clean — never embedded inside the notes file.

> **Convention:** See `skills/conventions/quality.md` for Iron Law back-linking.

Every attendee and company mentioned MUST get a back-link from their page to
the meeting page. An unlinked mention is a broken brain.

## Phases

> Phases 1–4 produce and refine the draft. Do NOT ingest into G-Brain until the
> user approves (Phase 4). Phases 5–8 are the ingestion + enrichment work.
> Phase 9 is the situation-specific output — routed to the variant file for the
> brain chosen in Step 0 (personal → follow-up; buildpurdue → team recap).

### Phase 1: Parse the transcript

Extract from the transcript:
- Attendees (names, roles if available). **Speaker labels (A/B) and ASR names are
  unreliable — confirm who is who with the user when it is ambiguous before
  attributing quotes or actions.**
- Date, time, duration
- Key topics discussed
- Decisions, action items (with owners), and **promises/commitments the user
  made to others** in the meeting (e.g. "I'll send you X", "I'll intro you to Y")
- Companies, projects, programs, and people mentioned

### Phase 2: Preserve the raw transcript (no body section)

```bash
$GB files upload-raw <file> --page meetings/<slug> --type transcript
```

For normal text transcripts this produces a git-tracked `.raw/` sidecar dir next
to the meeting page. Record it ONLY as a `raw_transcript:` frontmatter pointer
to that `.raw/` path (optionally also a `See Also` link). Never paste transcript
content into the page body, and never leave the only reference pointing at an
inbound media temp path.

### Phase 3: Build the meeting-notes draft (do NOT ingest yet)

Write the draft to `$BRAIN_DIR/meetings/<slug>.md` with frontmatter
(`type: meeting`, `title`, `date`, `raw_transcript:` pointer, `tags`). **Use the body
order for the notes format chosen in Step 0** — the standard order below, OR
`variants/leadership-notes.md` if the **leadership** notes variant was selected. **Capture ALL available source metadata** — for a source-backed
meeting (e.g. Fathom) that means `source`, `recording_id`, `fathom_url`, `share_url`,
`duration_min` in frontmatter AND a `## Source & Metadata` block in the body. Don't
drop fields the source gave you (share link, recording id, scheduled/recording times,
language, recorded-by, attendee emails) — capture more, not less.

```markdown
# {Meeting Title} — {Date}

**Attendees:** {list with [links](people/slug) <emails if known>}
**Date:** {YYYY-MM-DD} · **Format:** {phone/in-person/virtual} · {~duration if known}

## Source & Metadata
{For source-backed meetings (Fathom etc.) — include every field the source provides:}
- **Source:** {fathom} · **Recording ID:** {id} · **Language:** {en}
- **Recording link:** {url} · **Share link:** {share_url}
- **Scheduled:** {start–end} · **Recorded:** {start–end} (~{N} min)
- **Recorded by:** {email}
{Omit this whole section only for meetings with no source metadata.}

## Executive Summary
{tight skim-first paragraph: what it was about, what mattered, what changed/decided}

## Key Takeaways
{the sharpest strategic points — signal, not transcript replay}

## Key Decisions
{optional — concrete decisions/agreements reached, with context. Omit if none.}

## Learnings or Useful Later
{optional — a reusable lesson, mental model, tactic, intro, or warning worth
remembering later. Omit the section entirely if nothing qualifies.}

## Action Items
{concrete things the user can directly do, with owners/deadlines.
ALSO scan the transcript for promises/commitments the USER made to others in the
meeting (e.g. "I'll send you X", "I'll intro you to Y", "I'll look into Z") and
add each as its own action item, tagged `(promise)` at the end so it stands out —
e.g. "- Send Ben the list of events I end up attending (promise)".}

## Next Steps
{directional moves that matter but aren't yet atomic tasks}

## Meeting Historical Breakdown
### 1. {segment label}
- {factual bullets, in the order the conversation unfolded — not transcript sludge}
### 2. {segment label}
- ...

<!-- timeline -->

## Timeline
- {YYYY-MM-DD} — {one-line dated summary}

## See Also
- {links to attendees, companies, programs, places}
- Raw transcript: `meetings/<slug>.raw/<file>`
```

### Phase 4: Review loop with the user (MANDATORY — before ingestion)

Show the user the current draft and iterate until it's right. **This is not
optional, and it happens before any G-Brain ingestion.**

When showing the notes, attach the **actual canonical brain page file at its real
in-brain path** (`$BRAIN_DIR/meetings/<slug>.md`) — the same file being
edited in place, the same path on every iteration. Never attach a temp copy, a
regenerated duplicate, or an inbound-media path. If the surface can't attach,
quote the relevant sections and give that same path.

Stay in the loop until the user is satisfied: tighten takeaways, fix missing
action items, correct names/links/people/companies (diarization is unreliable —
expect attribution fixes), trim overreach, improve the summary and the
historical-breakdown ordering. Only proceed once the user approves.

### Phase 5: Ingest the approved meeting into G-Brain

**Editing the `.md` on disk is NOT ingestion.** The engine (what search/retrieval
serves) is a separate store; a working-tree edit doesn't reach it. Push the
approved file into the engine explicitly:

```bash
$GB capture --file $BRAIN_DIR/meetings/<slug>.md --slug meetings/<slug> --type meeting
```

Then verify the engine matches the reviewed file before declaring it ingested:

```bash
$GB get meetings/<slug> | grep -E '^## '   # headings must match the file
```

If headings or `raw_transcript` differ, re-ingest until they match. Do not trust
the on-disk file as proof of ingestion.

### Phase 6: Attendee enrichment (MANDATORY)

For EACH attendee:
1. `$GB search "{name}"` — does a people page exist?
2. If NO → create via enrich skill (mandatory, not optional)
3. If YES → update compiled truth with meeting context
4. Add a timeline entry on the person's page:
   `$GB timeline-add <person-slug> <date> "Attended <meeting-title>"`

**Note:** Once the meeting page is ingested, the auto-link post-hook creates
`attended` links from the meeting to each attendee referenced as
`[Name](people/slug)`. You don't need `$GB link` for attendees. You DO still
need `$GB timeline-add` for dated events (auto-link handles links, not timeline
entries).

### Phase 7: Entity propagation (MANDATORY)

For each company, project, program, place, or concept discussed:
1. Check the brain for an existing page
2. Create/update as needed
3. Add a timeline entry referencing the meeting
4. Back-link from the entity page to the meeting page

### Phase 8: Timeline merge

The same event appears on ALL mentioned entities' timelines. If Alice met Bob at
Acme Corp, the event goes on Alice's page, Bob's page, AND Acme Corp's page.

### Phase 9: Situation output — route to the variant (after the notes are clean)

Phases 1–8 run the same everywhere. Only the **post-notes deliverable** differs by
situation, selected by the brain you picked in Step 0. Read and follow the matching
variant file:

| Brain (Step 0) | Variant file | Post-notes deliverable |
|---|---|---|
| Personal/EMS (default) | `variants/default-personal.md` | Follow-up message + execution / planner handoff |
| buildpurdue | `variants/team-recap-buildpurdue.md` | Team recap message (ready to post to the team) |

Open the variant file for the chosen brain and produce its deliverable as separate
chat output (never inside the notes file). A new situation later → add a
`variants/<name>.md` + a row here (and a brain row in Step 0 if it's a new brain).

## Output Format

The meeting page's fixed body order (raw transcript lives only in the `.raw/`
sidecar, referenced by the `raw_transcript:` frontmatter pointer — never a body
section):

```
1. Executive Summary
2. Key Takeaways
3. Key Decisions               (optional — omit if none)
4. Learnings or Useful Later   (optional — omit if nothing qualifies)
5. Action Items
6. Next Steps
7. Meeting Historical Breakdown (chronological segments with bullets)
8. ## Timeline                 (only if present: the append-only
                                <!-- timeline -->-marked block; stays dead last)
```

Final report after ingestion + enrichment:
"Meeting ingested: {N} attendees enriched, {N} entities updated, {N} action items
captured." Then produce the Phase 9 situation deliverable for the chosen brain
(personal → follow-up + execution; buildpurdue → team recap) as separate chat output.

## Anti-Patterns

- Blending the phases into one blob instead of running them in order
- Treating G-Brain ingestion as a separate, optional step after approval rather
  than part of this flow
- Running ingestion before the user has reviewed the notes
- Skipping the executive summary or the chronological historical breakdown
- Writing the historical breakdown as transcript sludge instead of structured
  segments with bullets
- Losing the distinction between `Action Items` and `Next Steps`
- Dropping promises the user made to others instead of surfacing each as its own
  `(promise)`-tagged action item
- Treating generic outcome targets as a canonical notes section
- Adding a standalone `## Transcript` body section instead of a `raw_transcript:`
  frontmatter pointer to the `.raw/` sidecar; pasting transcript into the body
- Putting the narrative `Meeting Historical Breakdown` below the append-only `## Timeline`
  block
- Embedding the follow-up draft or the execution split inside the meeting-notes file
- Drafting the follow-up before the meeting page is clean
- Treating a filesystem `.md` edit as ingestion — the engine is a separate store;
  ingest via `$GB capture`/`put`, then verify with `$GB get`
- Creating the meeting page without enriching attendees
- Skipping entity propagation ("I'll do that later")
- Not merging timelines across all mentioned entities
- Creating attendee stubs without meaningful content
- Filing meeting pages without cross-linking to all participants
- Auto-writing tasks into the brain task manager against user preference
