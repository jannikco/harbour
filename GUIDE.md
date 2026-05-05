# Harbour Agent Guide

This document covers everything an agent needs to work with Harbour. It is served at `GET /api/guide`.

## Overview

Harbour is a control plane that manages your recurring jobs, shared docs, data stores, and encrypted environment variables. It doesn't control how you do your work — it tells you *what* to do, *when*, and gives you the context to do it.

You poll for work. Harbour returns a job with instructions, referenced docs, database rows, and env vars. You do the work, log your activity, and mark it done — or set it to "waiting" if you need human input. Humans respond on the dashboard, and your next poll picks it up. You can also create and update shared docs and manage structured data through the API.

Key concepts:
- **Jobs** — recurring responsibilities with a schedule, instructions, and linked docs/data/env vars
- **Runs** — a single execution of a job, with an activity log of agent and human messages
- **Docs** — shared markdown documents, injected into runs automatically
- **Databases** — SQLite tables you create and manage, injected into runs automatically
- **Env Vars** — encrypted key-value pairs (API keys, tokens), decrypted and injected at runtime

## Scheduling

Jobs use the `schedule` field to define when they run. Harbour automatically computes `next_run_at` when a job is created, and advances it each time a run completes (status changes to `done`, `failed`, or `skipped`). You don't need to manage `next_run_at` yourself.

All schedule times use the system timezone configured in Settings (auto-detected from the server on first run).

**Choose the right schedule type for the job.** Most agent jobs should use short intervals (every few minutes), not weekly schedules. Use weekly/daily only for jobs that genuinely run on a calendar cadence (e.g. a weekly newsletter). For monitoring, triage, content posting, and most recurring work, use an interval.

### Schedule format

Schedules are JSON in one of two shapes:

**Interval** — run every N minutes:
```json
{"every": 5}
```

**Weekly** — run on specific days at a specific time:
```json
{"days": [1, 2, 3, 4, 5], "time": "09:00"}
```

Days are 0 (Sunday) through 6 (Saturday). Time is 24-hour `HH:MM`.

**Examples:**
- `{"every": 5}` — every 5 minutes (good default for most jobs)
- `{"every": 60}` — every hour
- `{"every": 1440}` — once a day
- `{"days": [1, 2, 3, 4, 5], "time": "09:00"}` — weekdays at 9am
- `{"days": [0, 1, 2, 3, 4, 5, 6], "time": "14:30"}` — daily at 2:30pm
- `{"days": [5], "time": "09:00"}` — Fridays at 9am

For convenience, the API also accepts human-readable strings and common cron expressions. These are automatically normalized to JSON on creation:
- `every 5 minutes` → `{"every": 5}`
- `daily at 9am` → `{"days": [0,1,2,3,4,5,6], "time": "09:00"}`
- `weekly on friday at 9am` → `{"days": [5], "time": "09:00"}`
- `*/5 * * * *` → `{"every": 5}`
- `0 9 * * 1-5` → `{"days": [1,2,3,4,5], "time": "09:00"}`

## Authentication

All API requests require a Bearer token in the Authorization header:

```
Authorization: Bearer hbr_<your_api_key>
```

API keys are issued when an agent is created and shown only once. Keys can be rotated from the dashboard.

## The Polling Loop

Agents pull work from Harbour on their own schedule. Harbour never calls out to agents.

### Get Next Work

```
GET /api/agents/:id/next
```

Returns the next thing for the agent to work on, or `null` if nothing to do.

**Priority order:**
1. Any stale `running` run past its job's timeout is automatically failed first
2. If the agent has a run in `running` status, returns `null` (agent is busy)
3. Any `pending` run (human responded, ready to resume) — resume it
4. Any `scheduled` run ready to start (one-off runs from dashboard) — claim it
5. Any recurring job past its scheduled time without an active run — create a new run
6. Nothing to do — returns `null`

**Response format:**
```json
{
  "run": {
    "id": "uuid",
    "status": "running",
    "activity": [...]
  },
  "job": {
    "id": "uuid",
    "name": "Morning Tweet",
    "instructions": "Write an engaging tweet about...",
    "model": null,
    "thinking": null
  },
  "docs": [
    { "id": "uuid", "title": "Brand Voice", "content": "..." }
  ],
  "data": {
    "metrics": [{ "_id": 1, "followers": 12400, "engagement_rate": 3.2 }],
    "tweet_history": [{ "_id": 5, "date": "2024-03-01", "text": "...", "impressions": 340 }]
  },
  "env": {
    "GITHUB_TOKEN": "ghp_...",
    "FIGMA_API_KEY": "figd_..."
  },
  "attachments": [
    {
      "id": "uuid", "kind": "file",
      "filename": "screenshot.png", "mime_type": "image/png", "size_bytes": 124000,
      "url": "https://your-harbour.example.com/api/runs/<run_id>/attachments/<id>/file",
      "title": null, "uploaded_by_type": "user", "uploaded_by_name": "Gavin"
    },
    {
      "id": "uuid", "kind": "embed", "embed_provider": "loom",
      "url": "https://www.loom.com/share/...", "title": "Walkthrough",
      "uploaded_by_type": "user", "uploaded_by_name": "Gavin"
    }
  ],
  "api": {
    "base_url": "https://your-harbour.example.com",
    "endpoints": {
      "update_status": "PUT https://your-harbour.example.com/api/runs/<run_id>/status",
      "post_activity": "POST https://your-harbour.example.com/api/runs/<run_id>/activity",
      "upload_attachment": "POST https://your-harbour.example.com/api/runs/<run_id>/attachments",
      "create_doc": "POST https://your-harbour.example.com/api/docs",
      "update_doc": "PUT https://your-harbour.example.com/api/docs/:id",
      "create_database": "POST https://your-harbour.example.com/api/databases",
      "insert_rows": "POST https://your-harbour.example.com/api/databases/:id/rows",
      "read_rows": "GET https://your-harbour.example.com/api/databases/:id/rows",
      "guide": "GET https://your-harbour.example.com/api/guide"
    },
    "status_options": ["done", "failed", "waiting"],
    "notes": [
      "You MUST set a final status (done/failed) when finished, or waiting if you need human input.",
      "Post activity messages to log progress — these are visible on the dashboard.",
      "Attachments belong to the run thread — files (multipart) or video URL embeds (JSON {url}).",
      "Full API spec available at the guide endpoint."
    ]
  }
}
```

Everything the agent needs is bundled in one response: the run, job instructions (with optional per-job model/thinking overrides), referenced docs, linked database rows (most recent 100 per table), decrypted env vars, attachments (files + URL embeds), and the `api` section with pre-resolved endpoints for this run and available status options. Use the endpoints in `api` to update run status, post activity, upload attachments, and manage docs and databases — no need to construct URLs yourself.

The `env` field contains decrypted environment variables linked to the job. Use these for API keys, tokens, and other credentials needed during the run.

The `attachments` field is the list of files and URL embeds attached to the run. Files have a download `url` that you can fetch with the same Bearer token. Embeds carry the source URL (Loom, YouTube, Vimeo) — humans see these as inline iframes on the dashboard.

### Peek (Read-Only Check)

```
GET /api/agents/:id/next?peek=true
```

Check if work is available without claiming anything. Useful for cron guards.

## Run Lifecycle

### Update Status

```
PUT /api/runs/:id/status
Content-Type: application/json

{ "status": "waiting" }
```

Valid statuses:
- `scheduled` — created from dashboard, waiting to be picked up
- `running` — agent is actively working
- `waiting` — agent needs human input (surfaces on dashboard)
- `pending` — human has responded, queued for agent pickup (set automatically when a human responds to a waiting run)
- `done` — completed successfully
- `failed` — something broke (or timed out)
- `skipped` — workflow determined nothing to do (exit code 77)

When a run transitions to `done`, `failed`, or `skipped`, Harbour automatically advances the job's `next_run_at` to the next scheduled time. No manual schedule management needed.

**Retrying:** Failed and skipped runs can be retried from the dashboard via `POST /api/runs/:id/retry`. The run goes back to `pending` with a system activity note, and the agent picks it up on next poll.

**Timeouts:** Each job has a configurable `timeout_minutes` (default 30). If a run stays in `running` status longer than the timeout with no activity updates, it is automatically failed on the next poll with a system message. This prevents stuck runs from blocking the agent.

### Add Activity

```
POST /api/runs/:id/activity
Content-Type: application/json

{ "content": "Found 3 new mentions. Processing...", "attachment_ids": ["uuid", ...] }
```

Activity entries support markdown. They form the visible record of what happened during the run.

`attachment_ids` is optional. To attach files or embeds to a comment, upload them first via `POST /api/runs/:id/attachments`, then pass the returned ids in this field. Comments may have empty `content` if they only carry attachments.

### Attachments

Attach files (screenshots, PDFs, exports) or video URL embeds (Loom, YouTube, Vimeo) to a run. Both kinds appear in the activity thread on the dashboard and in the `attachments` array of `/next`.

**Upload a file (multipart/form-data):**

```
POST /api/runs/:id/attachments
Content-Type: multipart/form-data; boundary=...

--boundary
Content-Disposition: form-data; name="file"; filename="screenshot.png"
Content-Type: image/png

<binary>
--boundary--
```

Multiple `file` parts in one request are supported. Per-file limit is set by `HARBOUR_MAX_UPLOAD_MB` (default 100MB). Returns an array of attachment records.

**Attach an embed URL (JSON):**

```
POST /api/runs/:id/attachments
Content-Type: application/json

{ "url": "https://www.loom.com/share/abc123", "title": "Walkthrough" }
```

The provider (`loom`, `youtube`, `vimeo`, `generic`) is detected from the URL.

**List attachments:** `GET /api/runs/:id/attachments`
**Delete an attachment:** `DELETE /api/runs/:id/attachments/:aid`
**Download a file:** `GET /api/runs/:id/attachments/:aid/file` — same Bearer token works.

**The waiting flow:**

1. You need human input — set the run to `waiting` and add an activity message explaining what you need
2. The run surfaces on the dashboard. The human reads your message and responds
3. The status automatically changes from `waiting` to `pending` — the human's response is in the activity log
4. On your next `/next` poll, Harbour returns this `pending` run — status flipped to `running`, full activity history included
5. You read the human's response from the activity log and continue your work

Pending runs **always take priority** over scheduled jobs. Other jobs continue to fire normally while a run is waiting — work doesn't block.

## Databases

Databases are real SQLite tables managed through the API. Each database is a named table with typed columns — agents create them, insert rows, and link them to jobs. Linked databases are automatically injected into the `/next` payload.

### Create a Database

```
POST /api/databases
Content-Type: application/json

{
  "name": "tweet_history",
  "columns": [
    { "name": "date", "type": "TEXT", "required": true },
    { "name": "text", "type": "TEXT", "required": true },
    { "name": "likes", "type": "INTEGER" },
    { "name": "impressions", "type": "INTEGER" }
  ]
}
```

If a database with the same name already exists, it returns the existing one. Column types are native SQLite: `TEXT`, `INTEGER`, `REAL`. Every table gets an auto-incrementing `_id` column.

### Insert Rows

```
POST /api/databases/:id/rows
Content-Type: application/json

[
  { "date": "2024-03-01", "text": "Hot take: most API docs...", "likes": 156, "impressions": 5400 },
  { "date": "2024-03-02", "text": "Ship it Friday...", "likes": 89, "impressions": 3100 }
]
```

Body can be a single object or an array. Unknown columns are silently ignored.

### Read Rows

```
GET /api/databases/:id/rows?limit=50&offset=0&orderBy=date&order=DESC
```

Returns `{ rows: [...], total: 100, limit: 50, offset: 0 }`.

### Update a Row

```
PUT /api/databases/:id/rows/:rowId
Content-Type: application/json

{ "likes": 200 }
```

### Delete a Row

```
DELETE /api/databases/:id/rows/:rowId
```

### Add a Column

```
POST /api/databases/:id/columns
Content-Type: application/json

{ "name": "retweets", "type": "INTEGER", "default": 0 }
```

Schema changes are tracked in a migration history.

### Link a Database to a Job

```
POST /api/jobs/:id/data
Content-Type: application/json

{ "databaseId": "uuid" }
```

Linked databases are included in the `/next` payload (most recent 100 rows per table).

### Convenience Endpoint

Agents can also use the combined endpoint to create + link + seed in one call:

```
POST /api/agents/:id/data
Content-Type: application/json

{
  "name": "tweet_history",
  "columns": [{ "name": "date", "type": "TEXT" }, { "name": "text", "type": "TEXT" }],
  "jobId": "uuid",
  "rows": [{ "date": "2024-03-01", "text": "First tweet" }]
}
```

## Docs

Docs are top-level resources linked to jobs. When a job fires, all its linked docs are included in the `/next` payload automatically. Pinned docs are auto-attached to all new jobs and one-off runs. Agents can also create and update docs:

### Create a Doc

```
POST /api/docs
Content-Type: application/json

{ "title": "Content Calendar", "content": "## March 2024\n..." }
```

### Update a Doc

```
PUT /api/docs/:id
Content-Type: application/json

{ "content": "Updated content..." }
```

Doc revisions are preserved automatically.

## Tasks (Kanban Boards)

Some agent jobs are triggered by **tasks** — kanban-style cards on a project board — instead of a schedule. The flow is the same (poll, work, finish), but with two added expectations: (1) read the task content and prior activity log, and (2) move the card to a new stage when you finish.

### How a task-triggered run looks

When the job that fires has `trigger_kind = "task_stage"`, the `/next` payload includes a `task` field and the `api.endpoints` section includes two extra entries:

```json
{
  "run": { "id": "uuid", "status": "running", "task_id": "uuid" },
  "job": { "id": "uuid", "name": "Writer", "instructions": "...", "trigger_kind": "task_stage" },
  "task": {
    "id": "uuid",
    "title": "Write blog post: AI control planes",
    "description": "Use the brand-voice doc...",
    "project_id": "uuid",
    "project_name": "Marketing",
    "stage": { "id": "uuid", "name": "To Do", "is_terminal": false },
    "legal_transitions": [
      { "id": "uuid", "name": "Doing", "is_terminal": false }
    ],
    "activity": [
      { "kind": "created", "to_stage_name": "To Do", "created_at": 1735689600 },
      { "kind": "stage_change", "from_stage_name": "Review", "to_stage_name": "To Do",
        "author_type": "agent", "author_name": "Reviewer",
        "content": "Tone is too corporate; tighten the third paragraph." }
    ]
  },
  "api": {
    "endpoints": {
      "move_task_stage": "PUT https://your-harbour.example.com/api/tasks/<task_id>/stage",
      "post_task_activity": "POST https://your-harbour.example.com/api/tasks/<task_id>/activity",
      "...": "..."
    }
  }
}
```

### Required behavior for task-triggered runs

1. **Read the activity log first.** The `task.activity` field contains the full history of comments and stage changes — including reviewer feedback that kicked the card back to your column. Acting on a card without reading why it was returned is the most common failure mode.
2. **Do the work** described in `task.title` + `task.description`, using `job.instructions` as your standing process for cards in this column.
3. **Move the card** before marking the run done. Pick one of `task.legal_transitions` (the API rejects illegal moves with a 409). Forward = "I'm done with my part"; backward (e.g. back to "To Do" with a comment) = "this needs more work."

### Move a Task

```
PUT /api/tasks/:id/stage
Content-Type: application/json

{ "toStageId": "<one of legal_transitions[].id>", "comment": "Optional note explaining the move" }
```

The `comment` is recorded as part of the stage_change activity entry — use it when sending a card back to give the next agent (or the original author) actionable feedback.

### Comment on a Task

```
POST /api/tasks/:id/activity
Content-Type: application/json

{ "content": "Halfway done — pulling stats from the API now." }
```

Use comments to log progress that doesn't yet warrant a stage change. They show up on the task detail page in the dashboard.

### Why `done` requires a move

If you set the run to `done` while the task is still in your watched stage, the API returns 409 — otherwise the same job would re-pick the same card forever. If you genuinely can't complete the work, set the run to `failed` with an explanation in a comment; that releases the claim and the card stays put for a human to triage.

### Stages with no agent

Some columns (typically a final QA or "Done" stage) have no job watching them. Cards land there and wait for a human to move them — that's the human-in-the-loop flow. Nothing for an agent to do; just move cards into those stages when your part of the work is finished.

## Reference Runner

```bash
#!/bin/bash
# Polls Harbour and invokes the LLM when there's work

RESPONSE=$(curl -s -H "Authorization: Bearer $KEY" \
  "$HARBOUR_URL/api/agents/$AGENT_ID/next")
[ -z "$RESPONSE" ] || [ "$RESPONSE" = "null" ] && exit 0

RUN_ID=$(echo "$RESPONSE" | jq -r '.run.id')

# Your LLM invocation here
# RESPONSE contains the full run context
```
