# Convention: Reference people (canon figures)

Some `people/...` pages are humans the user **reads about** but does not
personally interact with -- a book's author, a historical figure, a public
creator, a framework source. They are real knowledge, worth a page, but they
have **no dated history in the user's own life**, so the entity coverage
metrics (`timeline_coverage`, `entity_link_coverage`) flag them as permanently
incomplete with no honest fix.

The `reference: true` frontmatter flag resolves this.

This is intentionally **people-only**. Do not apply `reference: true` to
`companies/...` pages.

## Reference decision gate (MANDATORY)

Before creating any NEW `people/...` page from external/public source material,
stop and answer:

- Is this person part of Elliot's reachable world?

Decision:

- **Yes** -> normal person page. Do NOT mark it reference.
  Reachable world includes:
  - Elliot has interacted with them directly
  - someone Elliot knows personally mentioned them as a real human lead/contact
- **No; the user only reads/watches/listens to material ABOUT them** -> mark it
  reference.
- **Unsure** -> stop and inspect the source material before writing the page.

Hard invalid state:

- If a `people/...` page has `reference: true` **and** real interaction evidence
  (meeting backlinks, email/calendar/contact evidence, direct-contact fields,
  interaction timeline entries), it must be converted to normal immediately.

## What it does

- A `people/...` page with `reference: true` is **exempt from the entity
  coverage metrics only** (`timeline_coverage`, `entity_link_coverage`, and
  their onboard nudges).
- It keeps its real `type: person`, so it stays **fully searchable,
  enrichable, linkable, and edge-resolvable**. NOTHING about retrieval changes
  -- this is the whole reason it's a flag, not a new `type`.
- It is **opt-in**. Absent / `false` / anything-but-`true` = a normal entity
  that DOES count toward coverage. **This is the default — do not set it on real
  contacts.**

## When to set it

Set `reference: true` when the page is a person Elliot reads ABOUT, not someone
he deals with:

- authors and figures discussed in a book (book-mirror) or article
  (article-enrichment)
- historical / canon figures imported as reference knowledge
- creators from saved media / public-content ingest

Do NOT set it for people Elliot actually meets, emails, is introduced to, or
could realistically interact with through his live network. Those are normal
entities whose missing timeline/links is a real, actionable gap.

Do NOT set it for companies. Ever.

## Where this must be checked

Any workflow that can create a new `people/...` page from source material must
run the decision gate above before writing:

- article / book / media ingest
- idea / link ingest
- meeting, calendar, and email enrichment when a new attendee/sender is being
  created
- social monitoring / X-to-brain
- generic `put_page` calls that create a new `people/...` page

## How to set it

```bash
gbrain reference <people/slug>            # mark as reference
gbrain reference <people/slug> --unset    # back to a normal entity
gbrain reference audit --json             # deterministic drift audit
```

The command writes the flag to BOTH the markdown frontmatter (durable; survives
re-ingest / engine rebuild — markdown is the source of truth) AND the engine
JSONB (so coverage reflects it immediately, no re-sync). It's idempotent. You
can also hand-edit frontmatter (`reference: true`) and re-ingest.

For remote `put_page` callers creating a NEW `people/...` page, also pass an
explicit relationship decision:

```json
{
  "slug": "people/andy-grove",
  "content": "---\ntitle: Andy Grove\ntype: person\n---\n...",
  "entity_relationship": "reference"
}
```

Use `"entity_relationship": "real"` for normal people. This is the runtime
guardrail that prevents agent-side drift. `companies/...` pages must not send
`entity_relationship` and must not carry `reference: true`.

## Why a flag, not a type

A new `type: reference-person` would drop the page out of every
`type = person` flow -- search, enrichment, whoknows, link inference -- so
you'd lose the figure everywhere, not just the metric. The flag
narrows the change to exactly the coverage denominators and nothing else.

## Implementation

`src/core/reference-flag.ts` — `referenceExclusionSql(alias?)` is the single
source of truth for the predicate `(frontmatter->>'reference') IS DISTINCT FROM
'true'`, ANDed into both numerator and denominator at every coverage site
(getHealth in both engines, onboard/checks.ts, init-nudge.ts). Backed by the GIN
index on `pages.frontmatter`.
