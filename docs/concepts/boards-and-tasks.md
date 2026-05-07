# Boards and tasks

Boards are kanban canvases that agents can work against. A task is a card on a board. Tasks belong to a stage (column); jobs are configured to watch a specific stage and process its cards.

## The mental model

A board has stages. Stages have ordered task cards. An agent's job can be configured to **watch** a stage — when a card lands there, the job's next poll picks it up, the agent does the work, and the agent moves the card to a new stage to mark its part done.

It's a small idea. The interesting bits aren't the cards themselves — they're the contract around how an agent interacts with one:

| Property | What it gives you |
|---|---|
| **Atomic claim** | Two agents polling the same column at the same instant can't double-pick a card. The claim is a CAS update; one wins, the other rolls back. |
| **Transitions enforced server-side** | The board declares which moves are legal (e.g. `To Do → Doing`). The API rejects illegal moves with a 409 — the agent can't accidentally drop a card into the wrong column. |
| **Move-before-done gate** | A task-triggered run cannot reach `done` while the task is still in the watched stage. Otherwise the same job would re-pick the same card forever. |
| **Activity travels with the card** | When the writer re-picks a kicked-back card, the `/next` payload includes the reviewer's prior comments inline. The agent gets the full context of "why is this card back?" without a second API round-trip. |
| **Cards are runs** | Every pickup spawns a normal run. Attachments, status, kill/resume, retries, output streaming — the entire run runtime works on cards too. The card's journey shows up in the run history and vice versa. |

The card UI itself is intentionally dumb. It does no LLM magic on its own; the smart contract above is what makes it more useful than "agent watches Trello."

## A worked example

A two-agent ad-copy review loop:

```
Marketing project:
  Board: Tasks
    [To Do] -> [Doing] -> [Review] -> [Done]
    Review -> To Do (kick-back path)

Agents:
  Writer  — job watches "To Do"
  Reviewer — job watches "Review"
```

A human creates a card "Spring launch announcement" in **To Do**.

1. Writer's next poll picks it up. The card is now claimed by Writer's run.
2. Writer moves the card `To Do → Doing` (just to show progress), drafts copy, then `Doing → Review`. Posts `done`.
3. Reviewer's next poll sees the card in **Review**, claims it.
4. Reviewer kicks it back: `Review → To Do`, comment "Tone is too corporate; tighten paragraph 2." Posts `done`.
5. Writer's next poll picks the card up again. The `/next` payload includes the reviewer's comment in `task.activity` — the agent reads it and revises.
6. Writer moves through `Doing → Review` again. Reviewer re-picks, approves, moves to **Done**.
7. **Done** has no agent watching it. The card sits there.

Eleven total activity entries on the card by the end — every move and comment, traceable.

## What's in `/next` for a task-triggered run

When the run's job has `trigger_kind = "task_stage"`, the polling response includes a `task` block alongside the usual run/job/docs/data/env/attachments:

```json
{
  "run":  { "id": "...", "status": "running", "task_id": "..." },
  "job":  { "id": "...", "name": "Writer", "trigger_kind": "task_stage", "..." },
  "task": {
    "id": "...",
    "title": "Spring launch announcement",
    "description": "Three ad variants, punchy.",
    "board_id": "...",
    "board_name": "Tasks",
    "project_id": "...",
    "project_name": "Marketing",
    "stage": { "id": "...", "name": "To Do", "is_terminal": false },
    "legal_transitions": [
      { "id": "...", "name": "Doing", "is_terminal": false }
    ],
    "activity": [
      { "kind": "created", "to_stage_name": "To Do", "..." },
      { "kind": "stage_change", "from_stage_name": "Review", "to_stage_name": "To Do",
        "author_name": "Reviewer", "content": "Tone is too corporate..." }
    ]
  },
  "api": {
    "endpoints": {
      "move_task_stage":    "PUT  /api/tasks/<task_id>/stage",
      "post_task_activity": "POST /api/tasks/<task_id>/activity",
      "..."
    }
  }
}
```

`task.legal_transitions` is the **only** set of stage IDs the agent may move the card to from here. The API will reject anything else with 409.

## The required move-before-done

When a task-triggered run tries to set status `done`, the API checks whether the task is still in the job's watched stage. If yes, it rejects with 409:

```json
{ "error": "Task is still in the watched stage. Move the task to a new stage before marking this run done, or set status to 'failed' if you couldn't complete it." }
```

This rule exists because the polling logic (see [Architecture](../reference/architecture.md)) re-fires task-triggered jobs whenever an unclaimed task sits in the watched stage. If a run could `done` itself without moving the card, the same job would keep re-picking the same card forever.

The escape hatch: if the agent can't actually do the work, it sets status `failed` (with a comment explaining why). That terminates the run and releases the claim, but leaves the card where it is for a human to triage.

## The atomic claim

Each task row has a nullable `claimed_by_run_id`. When the polling step picks an unclaimed card it does:

```sql
UPDATE tasks
SET claimed_by_run_id = ?, updated_at = unixepoch()
WHERE id = ? AND claimed_by_run_id IS NULL
```

The `IS NULL` predicate is the lock. Two parallel polls hitting the same card: one update affects 1 row and wins, the other affects 0 rows and rolls back its run insert.

The claim is released when the run reaches a terminal status (`done`, `failed`, `skipped`, `killed`). It is **not** released when the agent moves the card mid-run, so the agent can move a card across multiple stages within one run (e.g. `To Do → Doing → Review`) without losing the lock.

## Stages, transitions, and the board

Each project gets a default board on creation: `To Do → Doing → Review → Done`, with these transitions wired up:

- `To Do → Doing`
- `Doing → Review`, `Doing → To Do`
- `Review → Done`, `Review → To Do`

Any stage can be set as `is_terminal` (Done is, by default — purely a hint to the UI). You can rename, reorder, add, and delete stages from the board's **Configure stages** page. Deleting a stage is refused if any active task is in it or if any job watches it.

Multiple jobs may watch the same stage. The polling order is task position ascending then created_at — i.e. oldest cards on top of the column win the next claim. There's no fairness scheduler beyond that.

## Top-level boards (no project)

You don't need a project to use a board. The first time the harbour boots, a top-level board named "Tasks" is created with `project_id = NULL`. Solo installs with no projects can use that one board exclusively. Multi-project installs get one board per project (auto-created on `createProject`) plus the top-level board.

The Boards index (`/board` in All Projects mode with multiple boards) shows everything. With one board total, `/board` skips the index and goes straight to the board.

## Building task-watcher jobs

Create a job whose trigger is **Task stage** instead of **Schedule**:

- Pick a board and a stage to watch.
- Write the agent's standing instructions ("when a card lands here, do X, then move it forward to Review or back to To Do with a comment").
- The agent receives the card content + activity log on each pickup.

The same agent can have multiple task-stage jobs (one watching "To Do", another watching "Review"), or schedule-driven jobs alongside.

## What boards intentionally don't do

- **No auto-create from upstream sources.** If you want cards to come from email, RSS, GitHub issues, etc., write a separate workflow or agent that posts to `POST /api/tasks` (see [the admin guide](../../ADMIN_GUIDE.md)).
- **No assignment per card.** Assignment is per-stage — you "assign" a card to someone by moving it into a stage that they (or an agent's job) watch.
- **No notifications.** The dashboard is the only surface. The waiting-runs badge and watched-stage indicators are passive.
- **No archived-tasks browser.** Archive is a state in the data model, but the UI only shows active cards today.
- **No board templates.** Every project gets the same default `To Do → Doing → Review → Done`. Edit it after creation.

## Source-of-truth pointers

If you're hunting in code:

- `src/lib/db/tasks.ts` — claim, release, move, activity, the move-before-done helper.
- `src/lib/db/stages.ts` — stage CRUD, transition graph, deletion guards.
- `src/lib/db/boards.ts` — board CRUD and resolution.
- `src/lib/db/runs.ts` — the polling ladder. Step 4 picks schedule-triggered jobs; the step right after picks task-triggered jobs and runs the atomic claim.
- `src/app/api/tasks/[id]/stage/route.ts` — the move endpoint, returns 409 on illegal transitions.
- `src/app/api/runs/[id]/status/route.ts` — the move-before-done gate (`validateRunStatusTransition`).
- `GUIDE.md` — the wire contract an agent reads at `/api/guide`.
