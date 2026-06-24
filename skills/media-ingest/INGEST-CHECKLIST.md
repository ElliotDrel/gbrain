# Media-Ingest QA Checklist (intern-followable)

Goal: given ONE ingested item, decide if it was ingested correctly. Derived from
`SKILL.md` (the contract + the 5 hard guardrails). Work top to bottom. Anything that
fails is a flag. "the page" = the `concepts/<slug>.md` or `sources/<slug>.md` analytical
page. "the raw" = `sources/social/<platform>-<id>.txt`.

## A. Provenance / raw file
- [ ] **A1** The raw exists at `sources/social/<platform>-<id>.txt` (social/video). It is `.txt`, NOT `.md`.
- [ ] **A2** The raw was NOT synced into the engine. Check: `gbrain get sources/social/<platform>-<id>` returns empty. (Hard guardrail 3.)
- [ ] **A3** The raw has frontmatter with `_transcript_state` and metadata (author, createdAt). It is not empty/hand-written.
- [ ] **A4** There is exactly ONE page built per raw (no duplicate pages citing the same raw, unless intentional multi-source).

## B. Page filing & shape
- [ ] **B1** Filed by SUBJECT, not format: lives in `concepts/` (reusable idea) or `sources/` (artifact-specific). NOT `media/videos/...`.
- [ ] **B2** Frontmatter has `type:`, `title:`, and `tags:` (3-6 kebab-case tags).
- [ ] **B3** Has a real `## Summary` of key points — NOT a raw transcript paste. (Smell test: body should be much shorter than the raw transcript and in analysis form.)
- [ ] **B4** Header lines present: `**Author:**` (name + @handle for social), `**Source:**` (URL/path), `**Format:**`, and `**Created:**`/`**Posted:**`.
- [ ] **B5** `**Raw:**` link points to the actual `.txt` raw and the path resolves (file exists).

## C. Source attribution (default-source model)
- [ ] **C1** A `> **Default source:**` blockquote is present.
- [ ] **C2** Single-source page has ZERO per-line `[Source: ...]` tags (those are only for multi-source interleaving).
- [ ] **C3** A bottom `## Sources` section exists with a reference-style link (`[label]: <raw path>`) pointing at the RAW transcript (not a timestamp/line).

## D. Entity propagation (the Iron Law)
- [ ] **D1** `## People Mentioned` and/or `## Companies Mentioned` sections exist when the content names any.
- [ ] **D2** Every named person/company that HAS a brain page is back-linked from the page.
- [ ] **D3** Each such entity page has a back-link to this page AND a timeline entry. (Spot-check the creator.)

## E. "Why I Saved This"
- [ ] **E1** If present, it reads as Elliot's real reason — NOT invented, NOT a placeholder (`_Pending_`, "TODO", a guessed motive). (Hard guardrail 1.)
- [ ] **E2** If absent, that's fine — it's omitted until Elliot gives a reason. Absence is NOT a flag.

## F. Persistence
- [ ] **F1** The page IS retrievable from the engine: `gbrain get <slug>` returns content matching disk.
- [ ] **F2** Brain repo is clean (committed + pushed) — `git status --porcelain` empty for this page.

## What counts as a FLAG (out of place)
- Raw with real content (`_transcript_state: ok`) but NO page citing it.
- A page whose `**Raw:**`/`## Sources` link points to a missing file.
- `.txt` raw renamed to `.md`, or a social raw synced into the engine.
- A transcript paste with no analysis (B3 fail).
- An invented/placeholder `## Why I Saved This`.
- A named entity with an existing brain page that is NOT back-linked (D2/D3 fail).
- Duplicate concept pages for the same idea.
- Page on disk but not retrievable from engine (F1), or uncommitted (F2).

## Auto-OK (NOT flags)
- Raw with `_transcript_state` = empty/error/404/trivial and no page (auto-legit non-ingestable).
- Missing `## Why I Saved This` (E2).
- A `sources/` page (vs `concepts/`) — both are valid homes.
