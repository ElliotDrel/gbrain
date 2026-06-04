---
name: media-ingest
version: 1.0.0
description: |
  Ingest social-media, video, audio, PDF, book, screenshot, and GitHub repo
  content into the brain. Multi-format handling with entity extraction and
  backlink propagation. Covers Supadata-backed social/video ingest plus generic
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
  - "supadata this"
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
- Social-media / short-form video URLs (YouTube, TikTok, Instagram, X, Facebook,
  public video files) go through the SAME skill via a deterministic Supadata
  fetch that captures transcript **and** complete metadata in **one** raw file at
  `sources/social/<platform>-<id>.txt`
- Social raw stays disk-only provenance: `.txt`, never `.md`, never synced into
  the engine
- When the user saved a social/video item intentionally, ask why they saved it
  and preserve their exact phrasing under `## Why I Saved This`

> **Convention:** See `skills/conventions/quality.md` for Iron Law back-linking.

Every mention of a person or company with a brain page MUST create a back-link.

## Phases

### Phase 1: Identify format and fetch

| Format | Action |
|--------|--------|
| Social/video URL (YouTube, TikTok, Instagram, X, Facebook, public video file) | Run deterministic Supadata fetch: `node skills/media-ingest/scripts/social-fetch.mjs "<url>"` |
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
node skills/media-ingest/scripts/social-fetch.mjs "<url>"
```

- Works for YouTube, TikTok, Instagram, X (Twitter), Facebook, and public video
  file URLs via Supadata's `/transcript` + `/metadata` endpoints
- Reuses `SUPADATA_API_KEY` from env or `~/.openclaw/openclaw.json`
- Idempotent path: same `<platform>-<id>` overwrites, never duplicates
- Prints the absolute raw-file path on stdout when a file is written

**ONE ATTEMPT — credits are billed per request.** The script never retries.
Exit codes: `0` ok · `1` usage · `2` no api key · `3` metadata error ·
`4` transcript error. On **any** non-zero exit (or a `>>> SURFACE THIS TO THE
USER` line on stderr):

- **STOP.** Do NOT re-run the script and do NOT hand-write a raw file to paper
  over it
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

Wait for his reply and capture his **exact phrasing**. This becomes the
`## Why I Saved This` section. If he has nothing to add, omit the section rather
than inventing one.

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
