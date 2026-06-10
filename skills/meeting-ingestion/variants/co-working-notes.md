# Notes variant — Co-Working (leadership-framed)

Use this body order (instead of the standard Phase-3 template) when Step 0 selected the
**co-working** notes variant — a session where the user and a teammate **build a
deliverable together in real time** (an interview/question doc, an OKR doc, an event plan,
a website spec, a process). Unlike **leadership** (deciding *how to run the org*) or
**leadership-1on1** (coaching a report), the centerpiece here is **an artifact being
produced** and the design choices baked into it. This variant assumes the user is the
leader in the room, so it carries the leadership lens by default — you don't choose
between **co-working** and **leadership** for a build session; co-working wins.

Everything else in the skill (frontmatter, `## Source & Metadata`, attendee enrichment,
dual-brain, output variant, etc.) is unchanged; only the body sections differ.

Same rules as the standard format: **optional sections are omitted entirely when empty**,
and `Action Items` still scans for promises the user made to others (tag each `(promise)`).

## Body order

```markdown
# {Meeting Title} — {Date}

**Attendees:** {links + emails}
**Date:** {…} · **Format:** {…} · {~duration}

## Source & Metadata
{the standard metadata block — see Phase 3}

## Executive Summary
{tight skim: what you built/advanced together, and where the artifact stands now}

## Key Takeaways
{the sharpest points from the session — signal, not transcript replay. Same role as the
standard format's Key Takeaways; keep it skim-first.}

## Artifact / Output
{THE reason this format exists. The concrete thing produced or advanced and its CURRENT
STATE — e.g. the question doc's current question list, the decision reached, the spec as
it now stands. This is what the user will come back to retrieve. Be concrete enough that
the artifact is reconstructable from this section alone.}

## Design Decisions & Rationale
{the choices baked into the artifact and the WHY behind each — e.g. "scripted question
doc over open-ended, because non-conversational teammates need a quality floor." Decision
+ reasoning, paired. This is what stops a future reader from re-litigating settled calls.}

## Reusable Principles
{optional — transferable rules / mental models that surfaced mid-build and generalize
BEYOND this artifact (e.g. "never ask about the future; ask what happened"). Distinct from
Key Takeaways: takeaways summarize THIS session; principles are reusable elsewhere. Omit
if nothing generalizes.}

## Action Items
{concrete owner-tagged tasks; include `(promise)`-tagged commitments the user made.}

## Open Questions / Unresolved
{co-working sessions routinely end mid-thread — capture what was raised but NOT settled,
and the next decision needed. Never omit a real open thread; this is the format's
most-dropped, highest-value section. Note who decides / by when if said.}

## Next Steps
{directional moves that matter but aren't yet atomic tasks.}

## Meeting Historical Breakdown
{chronological segments with bullets — same as standard. Pushed to the bottom on purpose:
in a build session the artifact and decisions matter more than the turn-by-turn path.}

<!-- timeline -->

## Timeline
- {YYYY-MM-DD} — {one-line dated summary}

## See Also
- {attendees, companies, programs; companion brain page if dual; raw transcript}
```

## Notes
- Prioritize **Artifact / Output** and **Design Decisions & Rationale** — they're the
  reason this format exists. Months later the user wants "what did we build and why," not
  a replay of who said which clause.
- **Open Questions / Unresolved** is the safety net for the format's defining trait:
  these sessions often get cut off (a hard stop, a next meeting). Always sweep for the
  thread that was left hanging.
- Attribution-robust by design: attribute decisions and items by **content/meaning**, not
  by raw speaker labels. If the transcript's speaker tags are unreliable (phone-call ASR,
  mid-call label swaps), the synthesis sections still hold up because they're keyed on
  what was decided, not who uttered which line. Add a one-line caveat in the page when
  turn-level attribution is approximate; the raw `.txt` stays the ground truth.
