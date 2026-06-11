# Notes variant — Discovery Interview

Use this body order (instead of the standard Phase-3 template) when Step 0 selected the
**discovery-interview** notes variant — a structured interview where you extract research
signal from a **subject**: customer discovery, user research, a cohort/member feedback
interview. The centerpiece is **insight extraction** — a research goal, findings, and the
evidence behind them — not decisions (standard), org-running (leadership), coaching a report
(leadership-1on1), or an artifact (co-working).

Scope check: the subject is a customer / user / member you're learning *from*, and you're
mining for truth. A peer/external **advice** call (where the other person is helping *you*)
is not this — use **standard**. Coaching your own teammate is **leadership-1on1**.

Everything else in the skill (frontmatter, `## Source & Metadata`, attendee enrichment,
dual-brain, output variant, etc.) is unchanged; only the body sections differ.

Same rules as the other formats: **optional sections are omitted entirely when empty**, and
`Action Items` still scans for promises the user made to others (tag each `(promise)`).

## Body order

```markdown
# {Meeting Title} — {Date}

**Attendees:** {links + emails}
**Date:** {…} · **Format:** {…} · {~duration}

## Source & Metadata
{the standard metadata block — see Phase 3}

## Executive Summary
{tight skim: who the subject was, what you were trying to learn, and the headline finding}

## Subject Profile
{who the subject is + the segment/context needed to WEIGHT their answers — role, stage,
how representative they are. One founder's "6/10" isn't gospel; this section is why a
reader can trust or discount a given finding.}

## Research Goal
{what you set out to learn going in — the questions/hypotheses the interview was testing.
Frame the findings; keep it tight.}

## Key Findings
{THE meat. The insights extracted, grouped by theme, each tied to what the subject actually
said or did. Privilege BEHAVIOR over stated intent — what they did is signal; what they
predict they'll do is weak (flag predictions as low-confidence). Write findings so they're
COMPARABLE across interviews (consistent theming), because the value is aggregating many
interviews into a pattern, not this one in isolation.}

## Verbatim Quotes
{the subject's exact high-signal words. In discovery these are EVIDENCE, not decoration —
the one place paraphrase is banned. Quote the lines that capture a pain, a desire, a
priority, or a surprise in their own voice.}

## Surprises & Disconfirmed Assumptions
{what broke your priors — where reality contradicted what you expected going in. Usually
the highest-value section and the first one a generic format loses. Never omit a real one.}

## Implications
{so-what: what this finding set means for what you build / program / price / decide. The
bridge from research to action.}

## Action Items
{concrete owner-tagged tasks; include `(promise)`-tagged commitments the user made to the
subject (e.g. "I'll intro you to X").}

## Next Steps
{directional moves that matter but aren't yet atomic tasks — including who else to
interview to confirm/deny a finding.}

## Meeting Historical Breakdown
{chronological segments with bullets — same as standard. Pushed to the bottom on purpose:
in a discovery interview the findings + evidence matter more than the turn-by-turn path.}

<!-- timeline -->

## Timeline
- {YYYY-MM-DD} — {one-line dated summary}

## See Also
- {attendees, companies, programs; companion brain page if dual; raw transcript}
```

## Notes
- Prioritize **Key Findings**, **Verbatim Quotes**, and **Surprises & Disconfirmed
  Assumptions** — they're the reason this format exists. Months later you want "what did we
  learn and what's the evidence," not a replay of the conversation.
- **Behavior over stated intent**: a subject's account of what they actually did (skipped an
  event, filled out a form, paid for X) is hard signal; their prediction of future behavior
  is soft — capture it but mark it as such.
- **Comparability is the point**: theme findings consistently so N of these aggregate into a
  pattern. A finding that only makes sense inside this one interview is half-useless.
- Attribution-robust by design: attribute findings by content, not raw speaker labels. If
  the transcript's labels are unreliable, the findings still hold because they're keyed on
  what was said, not who uttered which line; add a one-line caveat when turn-level
  attribution is approximate, and keep the raw `.txt` as ground truth.
