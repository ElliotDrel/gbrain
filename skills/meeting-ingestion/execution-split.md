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
- **Never create a new task tracker as a side effect of meeting ingestion.** Only write
  Track items into `ops/tasks.md` if that page already exists in the target brain, or if
  the user explicitly asked for task-manager writes. If neither is true, keep the Track
  items in the final delivery only.

## Flow (split → do now → optionally add tracked tasks)
1. **Split** each action item into **Do now** vs **Track** (each Track item with
   owner=user, priority P0–P3, and a due date — default to the next meeting when none was
   stated).
2. **Execute the Do now items** immediately, or tee up the artifact (draft the email/doc),
   then mark them done.
3. **If a real task tracker already exists, or the user explicitly asked for it,** add the
   user's own Track items to the brain's `ops/tasks.md` via the `daily-task-manager` skill
   (owner, priority, due date) — automatically, without waiting for confirmation. Otherwise,
   do **not** create `ops/tasks.md`; leave the Track items unwritten and carry them forward
   in the final delivery for the user to review there.
4. **Surface the split** in that final delivery: what you did now, plus either the tasks you
   added or the Track items you intentionally did not write because no tracker exists.

## Notes
- This is separate from the follow-up method — a meeting always gets a follow-up; it only
  gets an execution split if it has action items.
- If there are no action items, skip this step entirely.
