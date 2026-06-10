---
name: media-ingest
version: 1.0.0
description: |
  Ingest social-media, video, audio, PDF, book, screenshot, and GitHub repo
  content into the brain. Multi-format handling with entity extraction and
  backlink propagation. Covers ScrapeCreators-backed social/video ingest plus generic
  media subtypes.
triggers:
  - "watch this video"
  - "process this YouTube link"
  - "process this youtube video"
  - "ingest this tiktok"
  - "save this tiktok"
  - "save this instagram reel"
  - "process this reel"
  - "ingest this instagram"
  - "save this video"
  - "ingest this video link"
  - "transcribe this video"
  - "save this short"
  - "process this x video"
  - "scrapecreators this"
  - "ingest this PDF"
  - "save this podcast"
  - "process this book"
  - "PDF book"
  - "summarize this book"
  - "ingest it into my brain"
  - "what's in this screenshot"
  - "check out this repo"
tools:
  - search
  - query
  - get_page
  - put_page
  - add_link
  - add_timeline_entry
  - file_upload
mutating: true
writes_pages: true
writes_to:
  - sources/social/
  - concepts/
  - people/
  - companies/
  - sources/
---

# Media Ingest Skill

Ingest social-media, video, audio, PDF, book, screenshot, and GitHub repo content into the brain.

> **Filing rule:** Read `skills/_brain-filing-rules.md` before creating any new page.

## Contract

This skill guarantees:
- Every ingested media item has a brain page with analysis (not just a transcript dump)
- Transcripts (video/audio) saved in raw and human-readable formats
- Entity extraction: every person and company mentioned gets back-linked
- Raw source files preserved via `gbrain files upload-raw`
- Filing by primary subject, not by media format
- Social-media / short-form video URLs (YouTube, TikTok, Instagram, X, Facebook)
  go through the SAME skill via a deterministic ScrapeCreators
  fetch that captures transcript **and** complete metadata in **one** raw file at
  `sources/social/<platform>-<id>.txt`
- Social raw stays disk-only provenance: `.txt`, never `.md`, never synced into
  the engine
- When the user saved a social/video item intentionally, ask why they saved it
  and preserve Elliot's exact phrasing under `## Why I Saved This` only after
  he gives it; build everything else first, but omit that section entirely until
  you have his words and keep following up until you get them

> **Convention:** See `skills/conventions/quality.md` for Iron Law back-linking.

Every mention of a person or company with a brain page MUST create a back-link.

## Phases

### Phase 1: Identify format and fetch

| Format | Action |
|--------|--------|
| Social/video URL (YouTube, TikTok, Instagram, X, Facebook) | Run deterministic ScrapeCreators fetch: `node skills/media-ingest/scripts/get-supadata-key.mjs \| node skills/media-ingest/scripts/social-fetch.mjs "<url>" --api-key-stdin` |
| Audio file | Transcribe with available STT service |
| PDF | Extract text (OCR if needed) |
| Book PDF | Extract text, identify chapters/sections |
| Screenshot/image | OCR via vision model, extract text and entities |
| GitHub repo | Clone, read README + key files, summarize architecture |

#### Social / short-form video path (integrated, not a separate skill)

For social-media and short-form video URLs, this skill owns the entire pipeline.
Do NOT route to another top-level skill first.

```bash
# Run from the workspace root (the agent's cwd). The script lives WITH this skill.
node skills/media-ingest/scripts/get-supadata-key.mjs \
  | node skills/media-ingest/scripts/social-fetch.mjs "<url>" --api-key-stdin
```

- Works for YouTube, TikTok, Instagram, X (Twitter), and Facebook via
  ScrapeCreators' per-platform metadata + transcript endpoints
- Reuses `SCRAPECREATORS_API_KEY` from `~/.openclaw/.env` or the process env via
  the local helper, and also passes through `SUPADATA_API_KEY` when available
- Transcript path is provider-tiered: ScrapeCreators first; if a video is over
  120 seconds and ScrapeCreators' transcript call fails, the same invocation
  falls back to Supadata transcript fetch before surfacing an error
- Idempotent path: same `<platform>-<id>` overwrites, never duplicates
- Prints the absolute raw-file path on stdout when a file is written

**DEDUP — the script refuses to re-fetch a post already on disk.** It is keyed by
the post's canonical shortcode/id (via `canonical-url.mjs`, which normalizes every
link shape — mobile host, `/reel` vs `/reels`, `?igsh=`/tracking params — and
follows **share/short links through a FREE redirect**, not an API call) and
checks twice: a free pre-check before any API call, and an authoritative backstop
after metadata (before the costly transcript call). So even a `vm.tiktok.com`
share link is de-duplicated for zero credits. If the post already has a
**complete** transcript on disk it exits `0`, prints the existing path, and logs
`[social-fetch] ALREADY INGESTED`. When you see that:

- **Do NOT re-file a duplicate concept page.** Tell Elliot the post was already
  ingested (cite the existing raw path / its concept page) and ask whether he
  wants anything changed before doing more work.
- A prior fetch that was incomplete (`_transcript_state` `empty`/`error`) is NOT
  treated as a duplicate — the script re-fetches to finish it. That is expected.
- To deliberately re-fetch a complete post (e.g. the transcript was wrong), pass
  `--force` — this bills credits, so only with Elliot's say-so.

**CONTENT DEDUP (gate 3).** The id-gate is per-platform, so the *same clip* cross-
posted elsewhere (different URL + id) passes it. After a successful fetch the script
fingerprints the transcript (`content-fingerprint.mjs`) and compares it to every
saved video on two axes:
- **near-duplicate** — high bigram Jaccard → same clip (incl. cross-platform repost).
- **clip-of-a-clip / subset** — high overlap coefficient → one video's transcript is
  contained in the other (a 1-min clip that's the first minute of a 3-min cut, or a
  trimmed/extended re-upload). Jaccard alone misses this; overlap catches it.

It prints `⚠ POSSIBLE DUPLICATE CONTENT — …` with the relationship, the matching
platform/id/URL, and the duration delta when known. This needs the transcript so it
runs *after* the (paid) fetch — it guards against a duplicate **page**, not the
credit. When you see it:

- **Surface it to Elliot** and ask if it's the same video.
- **Prefer adding the new URL as an extra source on the EXISTING concept page**
  (e.g. an "Also posted on" line / second source entry) rather than creating a new
  page. Only file a separate page if he confirms it's genuinely different.
- It never auto-skips — cross-platform sameness is a judgment call, so it's
  surfaced, not enforced.

**ONE INVOCATION — credits are billed per request.** The caller should not
blindly re-run the script. For ScrapeCreators transcript failures, the script
now performs the built-in backoff **within the same invocation** (wait 5s, then
30s, then 60s, then give up). Exit codes: `0` ok /
already-ingested · `1` usage · `2` no api key · `3` metadata error · `4`
transcript error. On **any** non-zero exit (or a `>>> SURFACE THIS TO THE USER`
line on stderr):

- **STOP.** Do NOT re-run the script again and do NOT hand-write a raw file to
  paper over it
- **Surface the exact failure to Elliot** — the HTTP status code and the error
  body the script printed
- Only proceed on exit `0` **with a transcript**. If exit `0` but the transcript
  is absent (`_transcript_state: empty`), tell Elliot the video has no
  captions/audio and confirm before building a transcript-less page

### Phase 2: Upload raw source

Save the original file for provenance: `gbrain files upload-raw <file> --page <slug>`

#### Social raw special case

For social/video URLs fetched by `social-fetch.mjs`, the raw sidecar is already
the provenance artifact:

- It MUST remain `sources/social/<platform>-<id>.txt`
- It MUST stay disk-only provenance
- Do NOT rename it to `.md`
- Do NOT ingest or sync it into the engine
- Do NOT split metadata and transcript into two files

Read the raw file the script wrote. Frontmatter has the full metadata object
(author, stats, duration, createdAt, etc.); body has the description and
plain-text transcript. This is your source material — do not re-fetch.

### Phase 3: Create brain page

**CONCEPT DEDUP — build, don't duplicate (gate 4). MANDATORY — never skip.** Gates 1-3
stop the same *video* being saved twice. They do NOT stop the same *idea* being saved
twice from two different videos (different words → no shared n-grams). Idea-sameness is
semantic, so BEFORE writing ANY `type: concept` page you MUST search the brain for the
proposed takeaway using the **`query` tool** (gbrain's hybrid vector+keyword search).

Run **two or three** queries phrased differently — the core takeaway in plain words,
plus a synonym/angle variant — so a near-duplicate filed under different wording still
surfaces. Do NOT filter to `concepts/` only: read whatever comes back (people, companies,
meetings too), because the right home or cross-link is often a non-concept page.

**Read the top hits** (don't trust the score alone — gbrain's RRF scores aren't
normalized and can exceed 1; judge by *reading* the page), then decide:

- **Same core idea** → *build on the existing page* (add this video as a corroborating
  source under `## Sources`, add any new angle/example/nuance, cross-link the creator)
  rather than filing a near-duplicate. Re-ingest the edited page (Phase 5).
- **Related but distinct** → file the new page AND cross-link both ways (`## See Also`),
  so the ideas build on each other instead of sitting as disconnected twins.
- **Novel** → file fresh.

Surface the merge-vs-new call to Elliot when it's ambiguous. This applies to any
concept-creating ingest, not just media. **Quote the queries you ran and the top hits
in your report**, so the dedup decision is auditable.

File by primary subject (not format). Use this template:

```markdown
---
type: {concept|note|source|...}
title: {Title}
tags:                 # MANDATORY 3-6 kebab-case; prefer existing — see conventions/tagging.md
  - {tag}
---

# {Title}

**Author:** {creator name + @handle, when the source has one}
**Source:** {URL or file path}
**Format:** {video/audio/PDF/book/screenshot/repo}
**Created:** {date}

> **Default source:** unless a line or section is tagged otherwise, everything on this
> page is from the [{ShortLabel}][{shortlabel}]. All sources are listed at the bottom;
> new sources tag only what they add or change.

## Summary
{Key points, not a transcript dump}

## Why I Saved This
{User's own words, directly under Summary.}

## {Body sections...}
{Key segments, history, etc. NO per-line [Source: ...] tags when single-source —
the Default-source note covers them.}

## People Mentioned
{List with links to brain pages}

## Companies Mentioned
{List with links to brain pages}

## Sources
- **[{ShortLabel}][{shortlabel}]** — {creator, title, venue/date}. *Primary source for this page.*
  Raw transcript: [{raw path}]({raw path})

[{shortlabel}]: {raw transcript path}
```

#### Social / short-form video page rules

Before writing a page for a social/video URL that the user intentionally saved,
ask Elliot directly:

1. **Why did you save this specific video?**
2. **Any notes or takeaways you want to highlight** — what hit hardest, what you
   want to remember?

Wait for Elliot's reply and capture his **exact phrasing**. This becomes the
`## Why I Saved This` section. Until he gives it, build the rest of the page
first, omit that section entirely, and keep following up rather than inventing
a reason or dropping in a placeholder.

Lead with `## Summary`, then the user's voice:

1. `## Summary` — a tight, self-contained summary of the **concept itself**
2. `## Why I Saved This` — Elliot's own words, immediately below the Summary

Social/video pages also MUST:

- Use the default-source model below, not per-line citations, when single-source
- Surface `author.displayName` + `author.username` + `verified` on an
  `**Author:**` line
- Surface `createdAt` as **Posted**
- Surface `media.duration` as quick format context when present
- Leave stale point-in-time `stats` in the raw unless engagement itself matters
- Link the raw file prominently, e.g.
  `**Raw:** [sources/social/<platform>-<id>.txt](sources/social/<platform>-<id>.txt)`
- File by primary subject:
  reusable mental model / framework / technique → `concepts/<slug>.md`
  artifact-specific talk / announcement / piece → `sources/<slug>.md`

### Source attribution (default-source model — set 2026-06-02 by Elliot)

Attribute **by exception**, not per line. Citation density should be proportional to how
mixed the sourcing is, and **zero for a single-source page**. Three escalating levels:

- **Level 0 — page default.** The `> Default source:` blockquote (right under the header)
  attributes the whole page to source 1. A single-source page therefore carries **no inline
  `[Source: ...]` tags at all** — do not add them.
- **Level 1 — section tag.** When a *new* source contributes a whole section/subsection,
  tag the heading once: `## Annual vs Quarterly [Doerr][doerr]`.
- **Level 2 — line tag.** Only when sources interleave *within* a section, tag the specific
  lines: `Doerr puts the company cadence at annual. [Doerr][doerr]`. Genuine contradictions
  keep both, side by side, each tagged.

Mechanism: **markdown reference-style links**. Each source is defined ONCE in the bottom
`## Sources` section (`[shortlabel]: <raw transcript path>`), and referenced inline as a
small `[ShortLabel][shortlabel]` tag that links straight to the **raw transcript** (not a
line). Pick a stable short label per source (speaker surname is ideal: `[Klau][klau]`).

Why this matters: because Level 0 covers source 1 by default, **adding source 2 is a minimal
diff** — you never re-tag the original source's ideas, you only tag what source 2 adds. This
is the read-enrich-write path for an already-existing page (see `brain-ops`). The `## Sources`
list is always present (even with one source) so the page is born ready to grow.

### Phase 4: Entity extraction and propagation

For every person and company mentioned:
1. Check brain for existing page
2. Create/enrich if needed (delegate to enrich skill)
3. Add back-link from entity page to this media page
4. Add timeline entry on entity page

A media item is NOT fully ingested until entity propagation is complete.

For social/video items, this includes the creator.

### Phase 5: Sync

`gbrain sync` to update the index.

## Output Format

Brain page created with summary, highlights, and entity cross-links. Report to user:
"Ingested {title}: {N} entities detected, {N} pages updated."

For social/video items:
"Ingested {title} ({platform}): raw at sources/social/{platform}-{id}.txt,
page at {path}, {N} entities propagated."

## Anti-Patterns

- **Inferring / fabricating `## Why I Saved This`.** This is Elliot's own signal --
  the one thing only he can answer. NEVER guess it from the content, the author, or a
  cluster of prior saves. Ask for it (while the fetch runs, not as a gate), finish the
  rest of the page first, and until Elliot gives his words, omit the section entirely and
  keep following up. A guessed reason pollutes the page with words Elliot never said.
- **Writing a placeholder `## Why I Saved This` section.** Do not write the section at all
  until Elliot has given his exact words. No stand-in text, no inferred summary, no
  `_Pending ..._` marker inside the page.
- Dumping raw transcripts without analysis
- Skipping entity extraction ("I'll do that separately")
- Two files for a social/video raw (separate transcript + metadata). One raw
  file, always
- Writing a social/video raw file by hand when the fetch fails
- Syncing/ingesting the social raw sidecar into the engine
- Filing **raw ingest** by format (all videos in `media/videos/`) instead of by subject. Note: format-prefixed paths under `media/<format>/<slug>` ARE sanctioned for **synthesized one-of-one output** like book-mirror's `media/books/<slug>-personalized.md`. The anti-pattern is for raw ingest, not for sui generis synthesis. See `skills/_brain-filing-rules.md` "Sanctioned exception: synthesis output is sui generis."
- Not preserving raw source files
- Creating stub pages without meaningful content
- **Per-line `[Source: ...]` tags on a single-source page.** Use the Level-0
  Default-source note instead; inline tags are for *exceptions* once a second
  source exists (see "Source attribution" above).
- Omitting the bottom `## Sources` section / reference-style link, or pointing a
  citation at a line/timestamp instead of the raw transcript file.
