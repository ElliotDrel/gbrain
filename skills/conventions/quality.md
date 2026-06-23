# Quality Convention

Cross-cutting quality rules for all brain-writing skills.

## Citations (MANDATORY)

Every fact written to a brain page must carry an inline `[Source: ...]` citation.

- **User's statements:** `[Source: User, {context}, YYYY-MM-DD]`
- **Meeting data:** `[Source: Meeting "{title}", YYYY-MM-DD]`
- **Email/message:** `[Source: email from {name} re: {subject}, YYYY-MM-DD]`
- **Web content:** `[Source: {publication}, {URL}, YYYY-MM-DD]`
- **Social media:** `[Source: X/@handle, YYYY-MM-DD](URL)`
- **Synthesis:** `[Source: compiled from {sources}]`

### Source precedence (highest to lowest)

1. User's direct statements (highest authority)
2. Compiled truth (brain's synthesized understanding)
3. Timeline entries (raw evidence)
4. External sources (API enrichment, web search)

## Back-Linking (MANDATORY)

Every mention of a person or company WITH a brain page MUST create a back-link
FROM that entity's page TO the page mentioning them.

Format: `- YYYY-MM-DD — Referenced in [page title](path) — context`

An unlinked mention is a broken brain.

### Link with `[[wikilinks]]`, not hand-built `](path)` links (MANDATORY)

Reference every entity (person/company/meeting/concept) with a bare-slug
**`[[wikilink]]`** — e.g. `[[nandini-katragadda]]`, `[[algolia]]` — NOT a
hand-written markdown path link like `[Name](people/name)`.

Why: wikilinks resolve through the engine and **degrade gracefully** — if the
target page doesn't exist yet, the link becomes a valid "page-to-create"
placeholder instead of a dead link. Hand-built `](relative/path)` links are
renderer-fragile (root- vs file-relative resolve differently per renderer) and
**silently break the moment they point at a page that doesn't exist** — which is
exactly how a batch of dangling links accumulated (audited & fixed 2026-06-23).

Rules:
- Default to `[[slug]]` for any entity reference. Use the final-segment slug only
  (no `people/`/`companies/` prefix); aliased `[[slug|Text]]` is not used here.
- **Never** point a markdown `](path)` link at a page that does not exist on disk.
  If the page isn't created yet, use a `[[wikilink]]` so it's a tracked placeholder.
- Reserve `](path)`/`](URL)` markdown links for external URLs and source
  citations, not internal entity navigation.

## Notability Gate

Before creating a new brain page, check notability:

- **People:** Will you interact again? Relevant to work/interests?
- **Companies:** Relevant to work/investments/interests?
- **Concepts:** Reusable mental model? Worth referencing again?

When in doubt, DON'T create. A 400-follower person who tweeted once is not notable.

## Reference Gate

For every NEW `people/...` page created from public/source material, also
decide whether the person is **real** (Elliot actually knows or can reach them)
or **reference** (he only reads ABOUT them). If reference is plausible, stop
and follow `skills/conventions/reference-entities.md` before writing.

Do not apply `reference` logic to `companies/...` pages.
