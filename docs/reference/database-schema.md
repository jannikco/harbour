# Database schema

A dense reference. Source of truth: `src/lib/db/schema.ts` (872 lines). The numbers below are computed from a freshly initialized DB, not paraphrased.

- **Tables: 33**
- **Indexes: 26 explicit** (plus auto-indexes on PRIMARY KEY / UNIQUE columns)

Notation in the column tables:
- **PK** — PRIMARY KEY (composite PKs noted in the description column)
- **FK** — REFERENCES, with the cascade behavior in parentheses
- **NN** — NOT NULL
- **U** — UNIQUE
- **CHECK** — has a CHECK constraint (described inline)
- Default values shown only when non-trivial; `created_at`/`updated_at` default to `unixepoch()` everywhere.

## Auth

### `users`
Human accounts for dashboard auth.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | uuid v4 |
| `email` | TEXT | NN, U | |
| `password_hash` | TEXT | NN | bcryptjs |
| `display_name` | TEXT | NN | |
| `created_at` | INTEGER | NN | |
| `updated_at` | INTEGER | NN | |

### `sessions`
Cookie-backed user sessions.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | the cookie value |
| `user_id` | TEXT | NN, FK → `users(id)` (CASCADE) | |
| `expires_at` | INTEGER | NN | epoch seconds |
| `created_at` | INTEGER | NN | |

Index: `idx_sessions_user(user_id)`.

## Agents and jobs

### `agents`
Top-level entity. Each agent has zero-or-many jobs and one API key.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `name` | TEXT | NN | |
| `description` | TEXT | | |
| `api_key_hash` | TEXT | NN | bcrypt'd bearer key |
| `last_polled_at` | INTEGER | | updated by `/api/agents/:id/next` |
| `type` | TEXT | NN, default `'external'` | `'external'` or `'harbour'` |
| `cli` | TEXT | | `'claude'` / `'codex'` / `'gemini'` (harbour agents) |
| `model` | TEXT | | default model override (harbour agents) |
| `thinking` | TEXT | | default thinking/effort override |
| `remote` | INTEGER | NN, default 0 | runner lives off-host |
| `created_at` | INTEGER | NN | |
| `updated_at` | INTEGER | NN | |

### `jobs`
Static configuration for recurring work.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `agent_id` | TEXT | FK → `agents(id)` (CASCADE) | **nullable** for workflow-only jobs |
| `name` | TEXT | NN | |
| `description` | TEXT | | |
| `instructions` | TEXT | | the prompt body for agent jobs |
| `schedule` | TEXT | NN | normalized JSON: `{"every":N}` or `{"days":[0-6],"time":"HH:MM"}` |
| `workflow_command` | TEXT | | shell command (gate or full job) |
| `workflow_only` | INTEGER | NN, default 0 | 1 = no agent involved |
| `timeout_minutes` | INTEGER | NN, default 30 | |
| `one_off` | INTEGER | NN, default 0 | 1 = deactivate after first run |
| `active` | INTEGER | NN, default 1 | |
| `last_run_at` | INTEGER | | |
| `next_run_at` | INTEGER | | populated by schedule advance |
| `model` | TEXT | | per-job override (harbour agents) |
| `thinking` | TEXT | | per-job override |
| `trigger_kind` | TEXT | NN, default `'schedule'` | `'schedule'` or `'task_stage'` |
| `watched_stage_id` | TEXT | FK → `stages(id)` (SET NULL) | required when `trigger_kind='task_stage'` |
| `created_at` | INTEGER | NN | |
| `updated_at` | INTEGER | NN | |

Indexes: `idx_jobs_agent(agent_id)`, `idx_jobs_schedule(agent_id, active, next_run_at)`.

### `runs`
A single execution of a job.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `job_id` | TEXT | NN, FK → `jobs(id)` (CASCADE) | |
| `agent_id` | TEXT | FK → `agents(id)` (CASCADE) | nullable for agentless workflow runs |
| `status` | TEXT | NN, CHECK | `scheduled \| running \| waiting \| pending \| done \| failed \| skipped \| killed` |
| `scheduled_for` | INTEGER | | for one-off runs |
| `claimed_at` | INTEGER | | set when status flips to `running` |
| `completed_at` | INTEGER | | set on terminal status |
| `kill_requested_at` | INTEGER | | dashboard kill trigger |
| `task_id` | TEXT | FK → `tasks(id)` (SET NULL) | task-triggered runs |
| `extra_instructions` | TEXT | | trigger-time override appended to prompt |
| `session_id` | TEXT | | CLI session ID for resume |
| `session_cwd` | TEXT | | working dir captured for resume |
| `created_at` | INTEGER | NN | |
| `updated_at` | INTEGER | NN | |

Indexes: `idx_runs_job(job_id)`, `idx_runs_agent(agent_id)`, `idx_runs_status(status)`, `idx_runs_task(task_id)`.

### `run_activity`
Ordered log of human/agent/system messages on a run.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `run_id` | TEXT | NN, FK → `runs(id)` (CASCADE) | |
| `author_type` | TEXT | NN, CHECK in (`agent`, `user`, `system`) | |
| `author_id` | TEXT | | |
| `author_name` | TEXT | | |
| `content` | TEXT | | |
| `created_at` | INTEGER | NN | |

Indexes: `idx_run_activity_run(run_id)`, `idx_run_activity_run_time(run_id, created_at)`.

### `run_output`
Streamed CLI events captured during execution. Backs the SSE stream at `/api/runs/:id/output/stream`.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | INTEGER | PK AUTOINCREMENT | monotonic; the SSE `?after=N` cursor |
| `run_id` | TEXT | NN, FK → `runs(id)` (CASCADE) | |
| `event_type` | TEXT | NN | `text_delta \| tool_start \| tool_end \| thinking \| info \| error \| result` |
| `content` | TEXT | | |
| `tool_name` | TEXT | | populated on `tool_*` events |
| `created_at` | INTEGER | NN | |

Index: `idx_run_output_run(run_id)`.

## Boards and tasks

### `boards`
Top-level kanban canvas. May belong to a project (or be top-level for solo installs).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `name` | TEXT | NN | |
| `project_id` | TEXT | FK → `projects(id)` (CASCADE) | nullable |
| `created_at` | INTEGER | NN | |
| `updated_at` | INTEGER | NN | |

Index: `idx_boards_project(project_id)`. Initialization always seeds at least one board (project-scoped boards on `createProject`; one top-level "Tasks" board if none exist) — see `src/lib/db/schema.ts:847-860`.

### `stages`
Kanban columns belonging to a board.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `board_id` | TEXT | NN, FK → `boards(id)` (CASCADE) | |
| `name` | TEXT | NN | UNIQUE per board |
| `position` | INTEGER | NN | display order |
| `is_terminal` | INTEGER | NN, default 0 | UI hint only |
| `created_at` | INTEGER | NN | |
| `updated_at` | INTEGER | NN | |

`UNIQUE(board_id, name)`. Index: `idx_stages_board(board_id, position)`.

### `stage_transitions`
Directed edges of legal moves between stages.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `from_stage_id` | TEXT | NN, FK → `stages(id)` (CASCADE), PK component | |
| `to_stage_id` | TEXT | NN, FK → `stages(id)` (CASCADE), PK component | |

Composite PK `(from_stage_id, to_stage_id)`. The `PUT /api/tasks/:id/stage` route rejects moves not present in this table with HTTP 409.

### `tasks`
Cards on a board.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `board_id` | TEXT | NN, FK → `boards(id)` (CASCADE) | |
| `stage_id` | TEXT | NN, FK → `stages(id)` (no cascade) | |
| `title` | TEXT | NN | |
| `description` | TEXT | | |
| `position` | INTEGER | NN | within stage |
| `claimed_by_run_id` | TEXT | FK → `runs(id)` (SET NULL) | **the CAS lock** |
| `archived_at` | INTEGER | | hides from default lists |
| `created_by_type` | TEXT | CHECK in (`user`, `agent`) | |
| `created_by_id` | TEXT | | |
| `created_at` | INTEGER | NN | |
| `updated_at` | INTEGER | NN | |

Indexes: `idx_tasks_stage_position(stage_id, position)`, `idx_tasks_board(board_id)`, `idx_tasks_claim(claimed_by_run_id)`.

**Invariant.** `claimed_by_run_id` is the atomic-claim lock used in step 5 of the polling ladder — see [Architecture › Polling ladder](architecture.md#polling-ladder). The clean release path is `releaseTaskForRun()` in `src/lib/db/tasks.ts`, called from `updateRunStatus` whenever the run hits a terminal state.

### `task_activity`
Comments and stage-change log entries.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `task_id` | TEXT | NN, FK → `tasks(id)` (CASCADE) | |
| `run_id` | TEXT | FK → `runs(id)` (SET NULL) | which run produced the entry |
| `kind` | TEXT | NN, CHECK in (`comment`, `stage_change`, `created`, `claimed`, `released`) | |
| `from_stage_id` | TEXT | FK → `stages(id)` | populated on `stage_change` |
| `to_stage_id` | TEXT | FK → `stages(id)` | populated on `stage_change` |
| `author_type` | TEXT | NN, CHECK in (`user`, `agent`, `system`) | |
| `author_id` | TEXT | | |
| `author_name` | TEXT | | |
| `content` | TEXT | | |
| `created_at` | INTEGER | NN | |

Index: `idx_task_activity_task(task_id, created_at)`. Activity travels in `/next` payloads as `task.activity` so an agent rehired on a kicked-back card sees the prior reviewer comment without an extra round-trip.

## Shared context

### `docs`
Top-level markdown documents. Linked to jobs via `job_docs`; pinned docs auto-attach to all new jobs.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `title` | TEXT | NN | |
| `pinned` | INTEGER | NN, default 0 | auto-attach toggle |
| `created_by_type` | TEXT | CHECK in (`user`, `agent`) | |
| `created_by_id` | TEXT | | |
| `created_at` | INTEGER | NN | |
| `updated_at` | INTEGER | NN | |

### `doc_revisions`
Append-only history. Newest row's `content` is the live body; older rows are diffable via `/api/docs/:id/revisions`.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `doc_id` | TEXT | NN, FK → `docs(id)` (CASCADE) | |
| `content` | TEXT | NN | full markdown snapshot |
| `author_type` | TEXT | CHECK in (`user`, `agent`) | |
| `author_id` | TEXT | | |
| `created_at` | INTEGER | NN | |

Index: `idx_doc_revisions_doc(doc_id)`.

### `databases`
Named registry of agent-managed SQLite tables (the underlying tables are siblings in the same DB).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `name` | TEXT | NN, U | display name |
| `table_name` | TEXT | NN, U | actual SQLite identifier |
| `created_at` | INTEGER | NN | |
| `updated_at` | INTEGER | NN | |

### `database_migrations`
Per-database DDL history (column additions, etc.).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `database_id` | TEXT | NN, FK → `databases(id)` (CASCADE) | |
| `version` | INTEGER | NN | monotonic |
| `description` | TEXT | | |
| `sql` | TEXT | NN | the executed DDL |
| `created_at` | INTEGER | NN | |

Index: `idx_database_migrations_db(database_id)`.

### `env_vars`
Encrypted key-value pairs (AES-256-GCM via `~/.harbour/encryption.key`).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `name` | TEXT | NN, U | env variable name |
| `encrypted_value` | TEXT | NN | base64(iv | tag | ciphertext) |
| `pinned` | INTEGER | NN, default 0 | auto-attach toggle |
| `created_at` | INTEGER | NN | |
| `updated_at` | INTEGER | NN | |

The plaintext is decrypted lazily inside `getDecryptedEnvVarsForJob()` and only travels in agent `/next` payloads.

### `settings`
Tiny key-value store. Keys include `timezone`, `signup_enabled`, `recent_runs_limit`, `captain_cli`, `captain_model`, `captain_thinking`, `captain_cwd`, `video_processing_*`.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `key` | TEXT | PK | |
| `value` | TEXT | NN | |

## Junctions (linking tables)

All composite PKs, all `ON DELETE CASCADE` on both sides.

| Table | A | B |
|---|---|---|
| `job_docs` | `job_id` → `jobs` | `doc_id` → `docs` |
| `job_databases` | `job_id` → `jobs` | `database_id` → `databases` |
| `job_env_vars` | `job_id` → `jobs` | `env_var_id` → `env_vars` |
| `project_agents` | `project_id` → `projects` | `agent_id` → `agents` |
| `project_jobs` | `project_id` → `projects` | `job_id` → `jobs` |
| `project_docs` | `project_id` → `projects` | `doc_id` → `docs` |
| `project_env_vars` | `project_id` → `projects` | `env_var_id` → `env_vars` |
| `project_databases` | `project_id` → `projects` | `database_id` → `databases` |

## Attachments and processing

### `attachments`
Polymorphic — every row belongs to **exactly one** of a run or a task. Holds either a file (storage_path) or an embed (url + provider).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `run_id` | TEXT | FK → `runs(id)` (CASCADE) | |
| `task_id` | TEXT | FK → `tasks(id)` (CASCADE) | |
| `activity_id` | TEXT | FK → `run_activity(id)` (SET NULL) | links attachment to the activity entry it landed with |
| `kind` | TEXT | NN, CHECK in (`file`, `embed`) | |
| `filename` | TEXT | | file kind |
| `storage_path` | TEXT | | relative to `uploadsDir()` |
| `mime_type` | TEXT | | |
| `size_bytes` | INTEGER | | |
| `url` | TEXT | | embed kind |
| `embed_provider` | TEXT | | `youtube \| loom \| vimeo \| ...` |
| `title` | TEXT | | |
| `uploaded_by_type` | TEXT | CHECK in (`user`, `agent`) | |
| `uploaded_by_id` | TEXT | | |
| `uploaded_by_name` | TEXT | | |
| `created_at` | INTEGER | NN | |

**Invariant** (table-level CHECK): `(run_id IS NULL) != (task_id IS NULL)` — exactly one parent.

Indexes: `idx_attachments_run(run_id)`, `idx_attachments_task(task_id)`, `idx_attachments_activity(activity_id)`.

### `attachment_processing`
Tracks ffmpeg+whisper processing state for video attachments.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `attachment_id` | TEXT | NN, U, FK → `attachments(id)` (CASCADE) | one row per attachment max |
| `run_id` | TEXT | NN | denormalized for easy lookup |
| `status` | TEXT | NN, CHECK in (`queued`, `processing`, `done`, `failed`) | |
| `transcript_path` | TEXT | | relative to uploads dir |
| `screenshots_dir` | TEXT | | relative to uploads dir |
| `screenshot_count` | INTEGER | NN, default 0 | |
| `screenshot_interval` | INTEGER | | seconds between frames |
| `duration_seconds` | REAL | | |
| `error` | TEXT | | populated when `status='failed'` |
| `started_at` | INTEGER | | |
| `completed_at` | INTEGER | | |
| `created_at` | INTEGER | NN | |

Indexes: `idx_attachment_processing_attachment`, `idx_attachment_processing_run`.

## Captain

In-browser CLI chat. Server-side process manager spawns a CLI tool, streams output back via SSE.

### `captain_conversations`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `title` | TEXT | NN | |
| `cli` | TEXT | NN | `claude \| codex \| gemini` |
| `model` | TEXT | | |
| `thinking` | TEXT | | |
| `session_id` | TEXT | | CLI session for continuity |
| `cwd` | TEXT | | overrides default `~/.harbour/captain/` |
| `user_id` | TEXT | NN, FK → `users(id)` (CASCADE) | |
| `created_at` | INTEGER | NN | |
| `updated_at` | INTEGER | NN | |

Index: `idx_captain_conversations_user(user_id)`.

### `captain_messages`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `conversation_id` | TEXT | NN, FK → `captain_conversations(id)` (CASCADE) | |
| `role` | TEXT | NN, CHECK in (`user`, `assistant`) | |
| `content` | TEXT | NN, default `''` | accumulates as the response streams |
| `created_at` | INTEGER | NN | |

Index: `idx_captain_messages_conversation`.

### `captain_output`
Per-message stream events (text deltas, tool calls).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | INTEGER | PK AUTOINCREMENT | SSE cursor |
| `conversation_id` | TEXT | NN, FK → `captain_conversations(id)` (CASCADE) | |
| `message_id` | TEXT | FK → `captain_messages(id)` (CASCADE) | nullable |
| `event_type` | TEXT | NN | same vocabulary as `run_output` |
| `content` | TEXT | | |
| `tool_name` | TEXT | | |
| `created_at` | INTEGER | NN | |

Index: `idx_captain_output_conversation`.

## Admin

### `admin_api_keys`
Bearer keys that resolve to the **creator's** user identity for API auth.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `name` | TEXT | NN | |
| `api_key_hash` | TEXT | NN, U | bcrypt'd |
| `created_by_user_id` | TEXT | NN, FK → `users(id)` (CASCADE) | |
| `last_used_at` | INTEGER | | |
| `created_at` | INTEGER | NN | |
| `updated_at` | INTEGER | NN | |

## Projects

### `projects`
Optional view-layer grouping. Entities don't know about projects; the five `project_*` junctions hold the references.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `name` | TEXT | NN | |
| `created_at` | INTEGER | NN | |
| `updated_at` | INTEGER | NN | |

Junction tables: see [Junctions](#junctions-linking-tables). Auto-link behavior — adding a job to a project also links its agent, docs, env vars, and databases — lives in `src/lib/db/projects.ts` (`linkJobToProject`).

## FK graph

```
users ─────── sessions
   ├──── admin_api_keys
   └──── captain_conversations ──── captain_messages ──── captain_output
                                                              ↑
                                                              └── (also from convo)

agents ──── jobs ──── runs ──── run_activity ──── attachments (via activity_id)
                       │           │                ↑
                       │           └── run_output   │
                       │                            │
                       └────────── attachments ─────┤
                                                    │
boards ── stages ── stage_transitions               │
   │        ↑                                       │
   │        └── jobs.watched_stage_id               │
   │                                                │
   └── tasks ── task_activity                       │
        ↑   └─ claimed_by_run_id → runs ───────────┘
        └─ runs.task_id

docs ─── doc_revisions          databases ─── database_migrations
   │                                │
   └── job_docs ─── jobs            └── job_databases ─── jobs

env_vars ─── job_env_vars ─── jobs

projects
   ├── project_agents ──── agents
   ├── project_jobs ────── jobs
   ├── project_docs ────── docs
   ├── project_env_vars ── env_vars
   ├── project_databases ─ databases
   └── boards (boards.project_id, nullable)

attachment_processing ─ attachments
```

## Notable invariants

- **Polling-ladder atomicity.** The five-step claim sequence inside `getAgentNextRun` and `getNextWorkflowRun` runs as one `db.transaction`. The CAS lock for tasks is `UPDATE tasks SET claimed_by_run_id=? WHERE id=? AND claimed_by_run_id IS NULL`.
- **Move-before-done.** A run with non-NULL `task_id` cannot reach `done` while its task is still in the job's watched stage. Enforced in `validateRunStatusTransition` (`src/lib/db/runs.ts:44-53`).
- **Attachment polymorphism.** Table-level `CHECK ((run_id IS NULL) != (task_id IS NULL))`.
- **One-of-a-kind processing record.** `attachment_processing.attachment_id` is `UNIQUE` — a re-process deletes the old row first.
- **Agentless jobs.** When `workflow_only=1`, `agent_id` may be NULL on both `jobs` and `runs`. Picked up by `/api/workflows/next`.
- **Env var encryption.** Plaintext never lands in the DB. The encryption key is read from `HARBOUR_ENCRYPTION_KEY` or auto-generated at `~/.harbour/encryption.key`.
- **Schedule normalization.** Non-JSON legacy schedule strings are coerced to canonical JSON during initialization (`src/lib/db/schema.ts:687-696`).

## Migrations

`schema.ts` follows three sections in order, all triggered by a single `initializeSchema(db)` call from `getDb()` on first use:

1. **Pre-migrations** (lines 105-225) — destructive renames/drops that have to happen before fresh tables are created. Today this section handles the `run_attachments → attachments` rename (with the new polymorphic CHECK) and the legacy `project_stages → stages` boards-first refactor.
2. **`db.exec(...)` of `CREATE TABLE IF NOT EXISTS ...`** (lines 227-590) — idempotent table and index creation. This block describes the **target shape**; running it on an empty DB creates everything from scratch.
3. **Procedural ALTER blocks** (lines 592-844) — additive column adds (e.g. `agents.cli`, `jobs.workflow_only`, `runs.task_id`) and CHECK-constraint changes (rebuilding `runs` to add `'pending'`, `'scheduled'`, `'killed'` over time). Each block guards itself with a `PRAGMA table_info` lookup or `sqlite_master.sql LIKE` test, so re-running is a no-op.
4. **Backfills** (lines 847-871) — ensure each project has a default board, ensure a top-level board exists, ensure encryption key is initialized, ensure `timezone` and `signup_enabled` settings exist.

There is no separate migrations folder; the function above is the only migration runner. New schema changes go in as additional ALTER blocks — pattern: read `PRAGMA table_info`, branch on the column's existence, run the ALTER inside the same `initializeSchema` pass.
