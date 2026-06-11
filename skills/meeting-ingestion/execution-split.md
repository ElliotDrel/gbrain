# Execution split — do-now vs. task manager (all brains)

Run this whenever a meeting produced **Action Items**, regardless of brain. It's the
shared execution step (it used to live only in the personal variant). It runs after the
notes are ingested, alongside the routed follow-up — they're independent.

## What it does
Take the page's **Action Items** (the ones already captured, including `(promise)`-tagged
commitments) and split each into one of two buckets:

- **Do now** — the agent can actually do it now, or it's a genuine <5-minute action →
  do it (or tee up the artifact, e.g. draft the email/doc) immediately, then mark it done.
- **Track** — a real bounded task (concrete verb, bounded scope, an actual next move) that
  isn't doable this second → goes to the task manager.

Only concrete next moves become tasks — a vague target ("get to 15 interviews") doesn't qualify.

## Whose tasks, which brain
- Only add **the user's own** action items to the task manager. Other people's items stay
  in the follow-up / team recap for them — don't put teammates' tasks on the user's list.
- Tasks go into **the same brain** the meeting was ingested into (`ops/tasks.md` is
  per-brain): buildpurdue items → buildpurdue task page, personal → personal. Use that
  brain's `$GB` / the `daily-task-manager` skill against that brain — never `--brain`.

## Flow (propose → confirm → add)
1. **Propose the split** to the user as chat output: list the **Do now** items (with what
   you'll do) and the **Track** items (each with proposed owner=user, priority P0–P3, and
   a due date — default the due date to the next meeting when none was stated).
2. **Wait for the user's confirmation** before writing any task to the brain — the user
   confirms (and may re-bucket / edit) first. (This is the standing preference: propose,
   then add on confirm.)
3. On confirm: execute the **Do now** items, and add the **Track** items to the brain's
   `ops/tasks.md` via the `daily-task-manager` skill (owner, priority, due date). Report
   what was done and what was added.

## Notes
- This is separate from the follow-up method — a meeting always gets a follow-up; it only
  gets an execution split if it has action items.
- If there are no action items, skip this step entirely.
