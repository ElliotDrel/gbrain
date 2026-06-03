# Convention: Tagging (keep the vocabulary tight)

Tags are how pages connect. Two pages tagged `deep-work` link; one tagged
`deep-work` and another `focus-work` do **not** — the graph silently fragments.
Every tagging skill (enrich, media-ingest, meeting-ingestion, any page write)
MUST follow this.

## Before assigning tags — PREFER EXISTING

1. Run the deterministic vocabulary dump:
   ```bash
   gbrain tags list
   ```
   It prints every existing tag with its usage count.
2. Choose from existing tags whenever one fits the concept — even if your
   instinct is a slightly different word. `productivity` already exists → do not
   coin `productive` or `efficiency`.
3. Only coin a NEW tag when nothing existing genuinely covers the idea. New tags
   are kebab-case, singular, specific (`cognitive-load`, not `Cognitive Loads`).
4. 3-6 tags per page is the target. More dilutes; fewer under-connects.

## Keeping it clean — CONSOLIDATE

- `gbrain tags audit` clusters mechanical duplicates (case / separator / plural /
  1-char typo) and prints ready-to-run merge commands. These are safe to
  auto-apply.
- `gbrain tags merge <from> <to> --apply` repoints every page using `<from>` to
  `<to>` (dedup). It rewrites the frontmatter AND reconciles the engine in-process
  (`removeTag` + `addTag`), because `gbrain sync` only ADDS tags and never
  removes them. After `--apply`, just commit + push the frontmatter changes — no
  separate `gbrain sync` is needed for the tag move.
- **Semantic** synonyms (same idea, different word — e.g. `deep-work` vs
  `flow-state`) are NOT machine-detectable. They require reading `list` output
  with judgment. When merging semantic dupes, FLAG the proposed merge to the user
  first — a wrong merge loses a real distinction.

## Anti-patterns

- Tagging a page without first checking the existing vocabulary.
- Coining a near-synonym of an existing tag.
- Plural tags, TitleCase tags, space/underscore separators.
- Blind semantic merges without confirmation.
