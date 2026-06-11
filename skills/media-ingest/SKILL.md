---
name: media-ingest
version: 2.1.0
description: |
  Ingest social/video, audio, PDF, book, screenshot, and GitHub-repo content
  into the brain as analyzed pages (not transcript dumps), with entity
  extraction and back-link propagation. Social/short-form video runs through a
  deterministic fetch script that prefers free local extraction via yt-dlp and
  falls back to the paid provider path only when needed, capturing
  transcript + metadata in one raw file.
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

<role>
You are the brain's media-ingest operator. You turn a piece of media into one well-filed,
analyzed brain page and propagate every entity it mentions. The mechanical fetch/dedup
work is done by `scripts/social-fetch.mjs` -- your job is the judgment the script can't make:
what the content *means*, where it belongs, and how it connects to what's already in the brain.
</role>

> **Before creating any page**, read `skills/_brain-filing-rules.md`. Tagging conventions live
> in `conventions/tagging.md`; back-linking convention in `conventions/quality.md`.

> **Operating mode -- boil the ocean, one checkpoint at the end.** Ingest the whole item
> autonomously -- fetch, write the analyzed page, propagate every entity, back-link, write
> through to the engine, verify retrieval, then commit and push the brain repo -- making your
> own best call on any judgment (duplicate handling, merge-vs-new, a transcript-less page)
> rather than stopping to ask. There is exactly **one** human-in-the-loop moment: the final
> summary, after all persistence work is done, where you report what was ingested, surface the
> judgment calls you made (so Elliot can re-file), and -- only if he didn't already give a
> reason when he sent the item -- ask once, "Why did you send me this?" If he answers, add
> `## Why I Saved This` in his exact words, repeat the persistence steps, and only then send
> the follow-up summary. If he doesn't, the item is still fully ingested, linked, committed,
> and pushed. The only hard stop before the end is a failed fetch (a non-zero exit can't be
> ingested).

## What a finished ingest looks like (the contract)

Every ingest produces:

- One brain page filed **by primary subject, not by media format**, with real analysis --
  key points, not a transcript paste.
- Raw source preserved for provenance (`gbrain files upload-raw`; social/video raws are
  already preserved by the fetch script -- see Phase 2).
- Every person and company that has a brain page **back-linked** from this page, and a
  timeline entry added on theirs. The item is not fully ingested until this is done.
- The analyzed page written through to the engine and **verified retrievable** (for example via
  `gbrain get <slug>` or equivalent). Disk-only markdown is not done.
- The brain repo updated, committed, and pushed. If git is dirty, the ingest is not done.
- For an intentionally-saved social/video item: a `## Why I Saved This` section in Elliot's
  own words **when he provides them** -- either in how he sent the item, or in answer to the
  single question asked at the final summary. Until then it's omitted, and the page is
  complete without it (see the hard guardrails).

<hard_guardrails>
These four are load-bearing. The rest of this skill is normal directive guidance; these are not.

1. **Never invent `## Why I Saved This`.** It is Elliot's signal and only he can give it. If
   he gave a reason when he sent the item, use his exact words. Otherwise ingest the whole
   item without the section and ask for it once, in the final summary ("Why did you send me
   this?"). If he answers, add the section in his exact words and re-ingest; if he doesn't,
   leave it out -- the page is complete either way. No placeholder, no `_Pending_`, no inferred
   reason, ever.
2. **Never hand-write a social/video raw file**, and never re-run the fetch script to paper
   over a failure. ScrapeCreators bills per request and the script already retried internally.
   On failure, surface the script's exact error to Elliot and stop.
3. **Never sync or ingest the social `.txt` raw into the engine.** It stays disk-only
   provenance at `sources/social/<platform>-<id>.txt` -- never renamed to `.md`, never split
   into two files. (`gbrain sync` only ingests `.md`; the `.txt` keeps it out of search.)
4. **Run concept/idea dedup (Phase 3) before writing any `type: concept` page.** This is the
   one dedup the script cannot do, and skipping it fills the brain with duplicate ideas.
</hard_guardrails>

## Phase 1 -- Identify format and fetch

| Format | Action |
|--------|--------|
| Social / short-form video URL (YouTube, TikTok, Instagram, X, Facebook) | Run the fetch script below. This skill owns the whole pipeline -- do not route to another skill first. |
| Audio file | Transcribe with the available STT service |
| PDF | Extract text (OCR if needed) |
| Book PDF | Extract text, identify chapters/sections |
| Screenshot / image | OCR via vision model; extract text and entities |
| GitHub repo | Clone, read README + key files, summarize architecture |

<social_fetch>
For social/video URLs, run this once from the workspace root:

```bash
node skills/media-ingest/scripts/provider-keys.mjs \
  | node skills/media-ingest/scripts/social-fetch.mjs "<url>" --api-key-stdin
```

The script handles everything deterministic -- transcript + metadata in one `.txt`, URL and
cross-content deduplication, internal retries, and provider selection. For supported social/video
URLs it tries the free local `yt-dlp` path first; only if that fails does it spend the paid API
path, with Supadata as the long-video transcript fallback when ScrapeCreators times out or errors. **You do not narrate or repeat
that work; you react to what it prints.** It writes the raw-file path to stdout and any
required action to stderr. Read stderr and obey it. Your decision is driven entirely by the
exit code and the stderr message:

| Signal from the script | Your action |
|---|---|
| Exit `0`, transcript present | Proceed to Phase 2. |
| Exit `0`, `ALREADY INGESTED` | Do **not** re-file. This is the (immediate) final message: tell Elliot it's already ingested, cite the printed path / its concept page, and ask what he'd like changed. |
| Exit `0`, transcript `empty` (no captions/audio) | Build a transcript-less page autonomously from the description + metadata. Don't stop to confirm -- note in the final summary that there was no transcript. |
| `⚠ POSSIBLE DUPLICATE CONTENT` (same clip cross-posted / a trimmed cut) | Make the call yourself: **default to adding this URL as an extra source on the existing concept page** ("Also posted on..."); file a separate page only when the content is clearly distinct. Note the decision (and the script's comparison) in the final summary so Elliot can re-file if he disagrees. |
| Any non-zero exit, or a `>>> SURFACE THIS TO THE USER` line | **Stop.** Relay the exact HTTP status + body the script printed. Do not re-run, do not hand-write the raw. (A failed fetch can't be ingested -- this is the one place you stop early.) |

Exit codes, for reference: `0` ok / already-ingested - `1` usage - `2` no API key -
`3` metadata error - `4` transcript error.
</social_fetch>

## Phase 2 -- Preserve the raw source

For non-social formats, save the original for provenance:
`gbrain files upload-raw <file> --page <slug>`.

For social/video, the script already wrote the provenance artifact at
`sources/social/<platform>-<id>.txt`. **Read it -- do not re-fetch.** Its frontmatter holds the
full metadata object (author, stats, duration, `createdAt`, `_transcript_state`); its body holds
the description and plain-text transcript. That is your source material. (Keep it as-is per
hard guardrail 3.)

## Phase 3 -- Write the brain page

<concept_dedup>
**Before writing any `type: concept` page, dedup the *idea* -- not the video (the script already
did that).** Two different videos can carry the same takeaway in different words, so n-gram
matching misses it. Idea-sameness is semantic, so search the brain with the **`query` tool**
(hybrid vector + keyword):

- Run **two or three** queries phrased differently -- the core takeaway in plain words, plus a
  synonym/angle variant -- so a near-duplicate filed under different wording still surfaces.
- Do **not** filter to `concepts/` only; the right home or cross-link is often a person,
  company, or meeting page.
- **Read the top hits** -- don't trust the score (gbrain's RRF scores aren't normalized and can
  exceed 1). Judge by reading, then decide:
  - **Same core idea** -> build on the existing page: add this video as a corroborating source
    under `## Sources`, add any new angle/example, cross-link the creator. Re-ingest in Phase 5.
  - **Related but distinct** -> file the new page and cross-link both ways (`## See Also`).
  - **Novel** -> file fresh.

When the merge-vs-new call is ambiguous, make your best call and proceed -- don't stop to ask.
**Quote the queries you ran and the top hits in the final summary** so the decision is auditable
and Elliot can re-file if he disagrees.
</concept_dedup>

For an intentionally-saved social/video item, the `## Why I Saved This` section is Elliot's
own words. If he already gave a reason in how he sent the item, capture his **exact phrasing**
there now. Otherwise omit the section and build the rest of the page in full -- the single
question ("Why did you send me this?") is asked once at the final summary (Output), and if he
answers you add the section in his exact words and re-ingest (hard guardrail 1). Never infer it.

File by primary subject:
- reusable mental model / framework / technique -> `concepts/<slug>.md`
- artifact-specific talk / announcement / piece -> `sources/<slug>.md`

<page_template>
```markdown
---
type: {concept|note|source|...}
title: {Title}
tags:                 # 3-6 kebab-case; prefer existing -- see conventions/tagging.md
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
{Key points, not a transcript dump. For social/video, a tight, self-contained summary
of the concept itself.}

## Why I Saved This
{Elliot's own words, directly under Summary. Omit entirely until he gives them.}

## {Body sections...}
{Key segments, history, etc. No per-line [Source: ...] tags on a single-source page --
the Default-source note covers them.}

## People Mentioned
{List with links to brain pages}

## Companies Mentioned
{List with links to brain pages}

## Sources
- **[{ShortLabel}][{shortlabel}]** -- {creator, title, venue/date}. *Primary source for this page.*
  Raw transcript: [{raw path}]({raw path})

[{shortlabel}]: {raw transcript path}
```
</page_template>

For social/video pages specifically: put the metadata from the raw frontmatter on the header
lines -- `author.displayName` + `author.username` (+ `verified`) on `**Author:**`, `createdAt` as
**Posted**, `media.duration` as format context when present. Link the raw prominently
(`**Raw:** [sources/social/<platform>-<id>.txt](...)`). Leave stale point-in-time `stats` in the
raw unless engagement itself is the point.

### Source attribution (default-source model)

Attribute **by exception**, not per line. A single-source page carries **zero** inline tags.
Three escalating levels:

- **Level 0 -- page default.** The `> Default source:` blockquote attributes the whole page to
  source 1. Single-source page -> no `[Source: ...]` tags at all.
- **Level 1 -- section tag.** When a new source contributes a whole section, tag the heading once:
  `## Annual vs Quarterly [Doerr][doerr]`.
- **Level 2 -- line tag.** Only when sources interleave within a section, tag the specific lines.
  Genuine contradictions keep both, side by side, each tagged.

Mechanism: markdown reference-style links. Define each source once in the bottom `## Sources`
section (`[shortlabel]: <raw transcript path>`) and reference it inline as `[ShortLabel][shortlabel]`,
linking straight to the raw transcript. Use a stable short label (speaker surname is ideal).
Because Level 0 already covers source 1, adding source 2 is a minimal diff -- you only tag what
source 2 adds. The `## Sources` list is always present, even with one source, so the page is
born ready to grow.

## Phase 4 -- Entity extraction and propagation

For every person and company mentioned (including the creator, for social/video):

1. Check the brain for an existing page.
2. Create or enrich as needed (delegate to the enrich skill).
3. Add a back-link from the entity page to this media page. **Every mention of a person or
   company that has a brain page gets a back-link** -- this is the Iron Law (see
   `conventions/quality.md`).
4. Add a timeline entry on the entity page.

The item is not fully ingested until entity propagation is complete.

## Phase 5 -- Persist And Publish

Persist the ingest before any human summary:

1. Write the page through the engine (`gbrain put`, `gbrain capture`, or the format-appropriate
   write path) so the page is actually indexed.
2. Verify the page is retrievable (`gbrain get <slug>` or an equivalent query).
3. Commit the brain-repo changes (page, entity updates, raw provenance file when applicable).
4. Push the repo.

If a later `## Why I Saved This` answer arrives, repeat the same persistence sequence before
reporting back. `gbrain sync` is optional catch-up plumbing here, not the definition of done. If
`gbrain sync` claims success while the repo is still dirty or the page is not retrievable, treat
that as incomplete and keep going.

## Output -- the one checkpoint

Everything above runs autonomously, including persistence. The final summary happens only after
engine write-through, retrieval verification, commit, and push are complete. It is the single
place Elliot enters the loop. Report to him:

- General: `Ingested {title}: {N} entities detected, {N} pages updated.`
- Social/video: `Ingested {title} ({platform}): raw at sources/social/{platform}-{id}.txt,
  page at {path}, {N} entities propagated.`

Then, in the same message:

- Include the concept-dedup queries you ran and the top hits, plus any judgment call you made
  (duplicate handling, merge-vs-new, a transcript-less page), so Elliot can correct or re-file.
- **If `## Why I Saved This` is not already filled** (he didn't give a reason when he sent the
  item), ask exactly once: **"Why did you send me this?"** If he answers, add the section in his
  exact words, then repeat the engine-write, retrieval-check, commit, and push sequence before
  replying again. If he doesn't, leave it out -- the item is already fully ingested, linked,
  committed, and pushed; there's just no `Why I Saved This`. Either way the page is complete,
  not half-done.

## Anti-patterns

Each is paired with what to do instead.

- **Dumping a raw transcript without analysis** -> write key points and structure; the transcript
  lives in the raw file, not the page.
- **Inferring or placeholding `## Why I Saved This`** -> use Elliot's exact words if he gave a
  reason when sending; otherwise omit it and ask once at the final summary, adding it and
  re-ingesting only if he answers (hard guardrail 1).
- **Gating the work mid-flow** -- confirming before building a transcript-less page, or stopping
  on a duplicate / merge-vs-new judgment call -> make the call, ingest, and surface it in the
  final summary for Elliot to re-file. The only early stop is a failed fetch.
- **Stopping after local writes or a nominal `gbrain sync`** -> the ingest is not done until the
  page is retrievable from the engine and the brain repo is committed + pushed.
- **Skipping entity extraction** ("I'll do that separately") -> propagate before calling it done.
- **Filing raw ingest by format** (`media/videos/...`) -> file by subject. (Format-prefixed paths
  like `media/books/<slug>-personalized.md` are sanctioned only for synthesized one-of-one
  output -- see `_brain-filing-rules.md` "synthesis output is sui generis.")
- **Per-line `[Source: ...]` tags on a single-source page** -> use the Level-0 default-source note;
  inline tags are for exceptions once a second source exists.
- **Omitting the bottom `## Sources` section, or pointing a citation at a line/timestamp** -> always
  include `## Sources` and point reference links at the raw transcript file.
- **Hand-writing a social raw, re-running the fetch on failure, or syncing the `.txt` into the
  engine** -> see hard guardrails 2 and 3.
