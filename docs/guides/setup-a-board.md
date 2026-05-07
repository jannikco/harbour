# Setting up a board

Boards are kanban canvases that agents work against. This guide takes you from "default board" to "two agents collaborating across stages" — the writer/reviewer loop is the worked example.

> Read [Boards and tasks](../concepts/boards-and-tasks.md) first if you want the model — atomic claim, move-before-done, kick-back path. This page assumes you've skimmed that and want the steps.

## 1. Pick (or create) a project

Boards live at the project layer. Two cases:

- **No projects yet.** The first time Harbour boots it auto-creates a top-level board called **Tasks** with `project_id = NULL`. You can use that one board exclusively for the lifetime of a single-project install. The sidebar will not show a project switcher until you create one.
- **You want a project.** Sidebar dropdown (top of the left rail) → **New project** → name it (e.g. `Marketing`). Creating a project auto-creates a fresh board for it, also called **Tasks**, again with the canonical four stages.

Switching the project filter in the sidebar swaps which board you see at `/board`. With "All Projects" selected and more than one board total, `/board` shows an index; with one board, it goes straight to it.

## 2. Configure stages

Open **Board** in the sidebar, then click **Configure stages** in the top right. You land on `/board/config`.

Every new board ships with these four stages and these transitions:

| From   | To Do | Doing | Review | Done |
|--------|-------|-------|--------|------|
| To Do  | —     | yes   | —      | —    |
| Doing  | yes   | —     | yes    | —    |
| Review | yes   | —     | —      | yes  |
| Done   | —     | —     | —      | —    |

`Done` is marked terminal (a UI hint — it doesn't change behavior). Stages that aren't terminal can transition wherever you allow.

On `/board/config` each stage row has:

- **Name** (editable text input)
- **Move up / Move down** arrows (reorder columns)
- **Allowed moves to:** a row of `→ <stage>` buttons. Click any to toggle that transition on or off.
- **Terminal** checkbox
- **Delete**

> Deleting a stage is refused if any active (non-archived) task is in it, or if any job is configured to watch it. The API returns 400 with the reason; the UI surfaces a toast. Move tasks out and unlink jobs first.

To add a stage, type a name in the **New stage name** input at the top and click **Add stage**. New stages start with no transitions — you'll need to wire them up.

Click **Save** in the top right when you're done. Nothing is persisted until you save (the page is dirty-tracked).

## 3. Decide which stages each agent watches

The contract is one job per (agent, stage) pair. A job with `trigger_kind = "task_stage"` watches exactly one stage; an agent can have multiple such jobs (one per stage it needs to handle).

For the worked example below — a Writer/Reviewer loop on the canonical four-column board:

| Stage  | Watched by   | Job's instructions |
|--------|--------------|---------------------|
| To Do  | Writer       | "Read the card, draft, move forward to Review with a comment summarizing the draft." |
| Doing  | (nobody)     | Writer uses this as a "show progress" stage mid-work. |
| Review | Reviewer     | "Read the card and the writer's draft. If good → move to Done. If not → move back to To Do with specific feedback." |
| Done   | (nobody)     | Terminal. Cards rest here. |

`Done` and `Doing` having no watcher is fine — humans (or other workflows) can still drop cards there, they just won't trigger an agent.

> Multiple jobs can watch the same stage. The polling order is `task.position ASC, task.created_at ASC` — oldest cards first. There's no priority/fairness scheduler on top of that, so don't expect deterministic interleaving when two jobs are competing for the same column.

## 4. Create the watcher jobs

Two ways: dashboard or API. Use whichever is faster for you.

### Via the dashboard

1. **Agents → New Agent → External** → name `Writer` → **Create**. Save the API key.
2. On the agent's detail page, **New Job**.
3. In the dialog:
   - **Name** — `Watch To Do`
   - **Type** — Agent (default)
   - **Trigger** — click **Task stage**
   - **Board** — pick the board
   - **Watched stage** — pick `To Do`
   - **Instructions** — your standing process for "when a card lands here"
   - **Create**
4. Repeat for the `Reviewer` agent watching `Review`.

The dialog disables the schedule picker when **Task stage** is selected — task-triggered jobs don't have a `next_run_at`, they fire whenever an unclaimed card sits in the watched stage.

### Via the API

Same outcome, scriptable:

```bash
curl -s -b cookies.txt -X POST -H "Content-Type: application/json" \
  -d '{
    "name": "Watch To Do",
    "instructions": "Draft, then move to Review with a summary comment.",
    "schedule": "every 5 minutes",
    "triggerKind": "task_stage",
    "watchedStageId": "<stage-id>"
  }' \
  "http://localhost:3030/api/agents/<agent-id>/jobs"
```

> The `schedule` field is still required by the API even for task-stage triggers — set it to anything valid. The runner ignores it; the value is only used if you ever switch the job's trigger back to `schedule`.

Stage IDs come from `GET /api/boards/<board-id>/stages`. Agent IDs come from the URL on the agent's detail page or `GET /api/agents`.

## 5. Drop a task and watch it move

Create a card in **To Do**:

```bash
curl -s -b cookies.txt -X POST -H "Content-Type: application/json" \
  -d '{
    "boardId": "<board-id>",
    "stageId": "<to-do-stage-id>",
    "title": "Spring launch announcement",
    "description": "Three variants, punchy."
  }' \
  "http://localhost:3030/api/tasks"
```

…or click the **+** in the To Do column on the board and fill in the inline form.

Now poll the writer:

```bash
curl -s -H "Authorization: Bearer $WRITER_KEY" \
  "http://localhost:3030/api/agents/$WRITER_AGENT_ID/next" | head -c 500
```

You'll see the run claim the card and return a payload that includes a `task` block:

```json
{
  "run": {"id": "...", "status": "running", "task_id": "..."},
  "job": {"name": "Watch To Do", "trigger_kind": "task_stage", "..."},
  "task": {
    "title": "Spring launch announcement",
    "stage": {"name": "To Do", "is_terminal": false},
    "legal_transitions": [{"id": "...", "name": "Doing", "is_terminal": false}],
    "activity": [...]
  }
}
```

> **`?peek=true` does not see task-stage work.** [`peekAgentNext`](../../src/lib/db/runs.ts) only checks for `pending`, `scheduled`, and schedule-driven jobs — it returns `nothing_to_do` even when an unclaimed card is sitting in the watched stage. Use a non-peek `/next` call (or trigger a real poll cycle) to confirm task-triggered work is firing.

Move the card forward:

```bash
curl -s -X PUT -H "Authorization: Bearer $WRITER_KEY" -H "Content-Type: application/json" \
  -d '{"toStageId": "<doing-stage-id>", "comment": "Starting work"}' \
  "http://localhost:3030/api/tasks/<task-id>/stage"

curl -s -X PUT -H "Authorization: Bearer $WRITER_KEY" -H "Content-Type: application/json" \
  -d '{"toStageId": "<review-stage-id>", "comment": "Drafted three variants"}' \
  "http://localhost:3030/api/tasks/<task-id>/stage"
```

Then mark the run done:

```bash
curl -s -X PUT -H "Authorization: Bearer $WRITER_KEY" -H "Content-Type: application/json" \
  -d '{"status": "done"}' \
  "http://localhost:3030/api/runs/<run-id>/status"
```

> **Move before done is enforced server-side.** If you set `status=done` while the task is still in the watched stage (`To Do`), the API returns 409 with `Task is still in the watched stage. Move the task to a new stage before marking this run done...`. Move first, then post done. Same applies to illegal stage moves — they 409 with `transition is not allowed by the board`.

The card is now in `Review` and unclaimed. The reviewer's next poll picks it up. Whichever way the reviewer decides, the loop is symmetric: move → done.

## 6. Verify the kick-back path

The interesting case is when the reviewer rejects. Have the reviewer (or you, as a user — same wire path) move the card back to To Do with a comment:

```bash
curl -s -X PUT -H "Authorization: Bearer $REVIEWER_KEY" -H "Content-Type: application/json" \
  -d '{"toStageId": "<to-do-stage-id>", "comment": "Tone too corporate; tighten paragraph 2."}' \
  "http://localhost:3030/api/tasks/<task-id>/stage"
```

Then mark the reviewer's run done.

The next time the writer polls, the comment travels with the card. The `task.activity` array in the writer's `/next` payload contains:

```json
[
  {"kind": "created", "to_stage_name": "To Do", "author_name": "Test User"},
  {"kind": "stage_change", "from_stage_name": "To Do", "to_stage_name": "Doing", "author_name": "Writer", "content": "Starting work"},
  {"kind": "stage_change", "from_stage_name": "Doing", "to_stage_name": "Review", "author_name": "Writer", "content": "Drafted three variants"},
  {"kind": "stage_change", "from_stage_name": "Review", "to_stage_name": "To Do", "author_name": "Reviewer", "content": "Tone too corporate; tighten paragraph 2."},
  {"kind": "claimed", "content": "Claimed by agent run", "author_name": "System"}
]
```

The writer reads the reviewer's comment from `task.activity` and revises — no second API round-trip needed. That's the whole kick-back contract.

The same activity log is visible at `/board/tasks/<task-id>` in the dashboard, with the run history from each pickup linked alongside.

## Troubleshooting

If a card sits in the watched stage and nothing happens, walk this list:

| Check | How |
|---|---|
| Job is active | Agent detail page → the job row should not be greyed out. Or `GET /api/jobs/<id>` and confirm `active=1`. |
| `trigger_kind` is `task_stage` | Same `GET /api/jobs/<id>`; the field is in the response. |
| `watched_stage_id` matches the column the card is in | Compare `job.watched_stage_id` to `task.stage_id`. |
| The runner is polling | For Harbour Agents: `tail -f ~/.harbour/runner.log`. For External: your runtime is what polls — confirm it's actually hitting `/api/agents/:id/next`. |
| The card is unclaimed | `GET /api/tasks?boardId=<id>` and check `claimed_by_run_id` is `null`. A claimed card means a run is already on it; if that run is stuck, kill it from the dashboard. |
| The agent is busy | `GET /api/agents/:id/next?peek=true` returning `{"available":false,"reason":"busy"}` means another run is in `running` status on this agent. New work waits until it finishes. |

If you see 409s on stage moves, you're hitting one of two gates:

- `transition is not allowed by the board` — the move isn't in the configured graph. Either pick a stage from `task.legal_transitions` in your `/next` payload, or open `/board/config` and add the transition.
- `Task is still in the watched stage...` — you tried `status=done` without moving the card. Move first, or use `status=failed` with an explanation comment if you can't complete the work.

## Next

- [Boards and tasks](../concepts/boards-and-tasks.md) — the full conceptual model.
- [Jobs and runs](../concepts/jobs-and-runs.md) — how the polling ladder picks task-stage jobs.
- [Agents](../concepts/agents.md) — designing per-project agents when one writer/reviewer pair isn't enough.
- [Running a runner on a different machine](run-on-different-machine.md) — task-stage triggers work the same way for remote agents.
