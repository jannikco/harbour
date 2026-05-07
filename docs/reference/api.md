# API

Reference for the HTTP surface. The wire-level contract that **agents** read at runtime — payload shapes, error envelopes, status semantics — lives in two source files served live by the running server:

- **[GUIDE.md](../../GUIDE.md)** → served at `GET /api/guide`. The contract for **worker** agents (the ones that poll for runs).
- **[ADMIN_GUIDE.md](../../ADMIN_GUIDE.md)** → served at `GET /api/admin-guide`. The contract for **management** agents (admin-key holders that create agents/jobs/etc).

This page is the codebase-side complement: every route file in the repo, with method, path, auth wrapper, and a one-liner. **79 route files**, **123 HTTP method handlers** total.

## Authentication

| Method | Header / cookie | Resolves to | Set by |
|---|---|---|---|
| User session | `Cookie: harbour_session=<id>` | `users` row | `POST /api/auth/login` |
| Agent key | `Authorization: Bearer <key>` | `agents` row | `POST /api/agents` (creator-only) |
| Admin key | `Authorization: Bearer <key>` | the **creator's user identity** | Settings → Admin API Keys |

Source: `src/lib/auth.ts:25-55`. Every API route begins with `withAuth(...)` (any of the three) or `withUserAuth(...)` (user or admin key only — agents are 403'd). Two extra in-handler guards narrow scope further:

- `requireAgentOwnership(auth, agentId)` — agents can only act on their own resource.
- `requireTaskClaim(auth, taskId, hasActiveClaim)` — agents can only mutate a task they currently have an active run claim on.

Unauthenticated requests get a uniform `401 {"error":"Unauthorized"}`. `withUserAuth` rejecting an agent caller returns `403 {"error":"Forbidden"}`.

## Request shape conventions

- All bodies are JSON (`Content-Type: application/json`) **except** attachment uploads, which are `multipart/form-data` (busboy).
- All timestamps are epoch seconds (`unixepoch()` defaults in SQLite).
- All IDs are uuid v4 strings except `run_output.id` and `captain_output.id`, which are auto-increment integers (used as SSE cursors via `?after=N`).
- Errors return `{ "error": "<message>" }` with HTTP 4xx/5xx status. 409 is reserved for transition conflicts (illegal stage moves, kill-while-not-running, move-before-done).

## Common patterns

### Project filter

List endpoints accept `?projectId=<id>` to scope results to a project. Implementation pattern (e.g. `src/lib/db/runs.ts:153-164`): when `projectId` is set, the query joins `project_jobs` to filter. With no `projectId`, the full set is returned.

Endpoints that honor the filter: `GET /api/agents`, `/api/jobs`, `/api/runs`, `/api/docs`, `/api/env-vars`, `/api/databases`.

### List vs detail

- `GET /api/<thing>` — list. Lightweight. Filters via query string.
- `GET /api/<thing>/:id` — detail. Often joins related rows (e.g. run detail returns `{...run, activity, attachments}`; database detail returns `{...db, migrations, jobs}`).

### `/next` payload

Both `GET /api/agents/:id/next` and `GET /api/workflows/next` return either `null` (nothing to do) or a single payload with this shape (full schema in [GUIDE.md](../../GUIDE.md)):

```
{
  run:   { id, status, activity, task_id }
  job:   { id, name, instructions, workflow, workflow_only,
           model, thinking, timeout_minutes, trigger_kind }
  task:  { id, title, description, board_id, board_name,
           project_id, project_name, stage, legal_transitions, activity }   // task-triggered runs only
  docs:  [ { id, title, content } ]
  data:  { <database name>: [ ...rows ] }
  env:   { KEY: value }                    // decrypted at request time
  attachments: [ ...serialized ]           // includes pre-resolved URLs
  api:   { base_url, endpoints, status_options, notes }
}
```

The `api` block is built by `buildApiSection` at `src/app/api/agents/[id]/next/route.ts:8-45`. Endpoints are pre-resolved to full URLs so an agent can curl them directly without string concatenation. When the run is task-bound, two extra endpoints (`move_task_stage`, `post_task_activity`) and three extra notes appear.

### Streaming endpoints (SSE)

Server-sent events are used for live output:

- `GET /api/runs/:id/output/stream` — run output (poll DB every 500ms, emit `event: output`, then `event: done` on terminal status).
- `GET /api/captain/conversations/:id/stream` — captain output (same shape, scoped to a conversation).

Both accept `?after=<id>` to resume from an integer cursor. `Content-Type: text/event-stream`, no caching. Marked `export const dynamic = "force-dynamic"`.

## Routes

### Auth

| Method | Path | Wrapper | Purpose |
|---|---|---|---|
| POST | `/api/auth/signup` | (none — public) | Create user; gated by `signup_enabled` setting |
| POST | `/api/auth/login` | (none — public) | Verify password, set `harbour_session` cookie |
| POST | `/api/auth/logout` | (none — clears cookie) | Delete session row, clear cookie |
| GET | `/api/auth/me` | `withAuth` | Echo `{type, user|agent}` for the current principal |

### Agents

| Method | Path | Wrapper | Purpose |
|---|---|---|---|
| GET | `/api/agents` | `withAuth` | List agents; honors `?projectId=` |
| POST | `/api/agents` | `withUserAuth` | Create agent; for non-remote harbour agents also writes a runner config |
| GET | `/api/agents/:id` | `withAuth` | Fetch one agent |
| PUT | `/api/agents/:id` | `withAuth` | Update agent (name/description/model/thinking); syncs runner config for harbour agents |
| DELETE | `/api/agents/:id` | `withUserAuth` | Delete agent + its runner config |
| POST | `/api/agents/:id/rotate-key` | `withUserAuth` | Generate a new API key for the agent |
| GET | `/api/agents/:id/jobs` | `withAuth` | List the agent's jobs |
| POST | `/api/agents/:id/jobs` | `withAuth` | Create a job under this agent |
| POST | `/api/agents/:id/data` | `withAuth` | Convenience: create-or-link a database and seed rows |
| GET | `/api/agents/:id/next` | `withAuth` + `requireAgentOwnership` | **Polling** — returns next run payload or `null`. `?peek=true` for non-claiming check |

### Jobs

| Method | Path | Wrapper | Purpose |
|---|---|---|---|
| GET | `/api/jobs` | `withAuth` | List all jobs (agent + workflow-only); honors `?projectId=` |
| POST | `/api/jobs` | `withUserAuth` | Create an **agentless** workflow-only job |
| GET | `/api/jobs/:id` | `withAuth` | Fetch one job |
| PUT | `/api/jobs/:id` | `withAuth` | Update job |
| DELETE | `/api/jobs/:id` | `withAuth` | Delete job |
| POST | `/api/jobs/:id/trigger` | `withAuth` | Create a one-off run for this job (optional `extraInstructions`) |
| POST | `/api/jobs/:id/docs` | `withAuth` | Link a doc to the job |
| DELETE | `/api/jobs/:id/docs/:docId` | `withAuth` | Unlink a doc |
| POST | `/api/jobs/:id/data` | `withAuth` | Link a database to the job |
| DELETE | `/api/jobs/:id/data/:dataId` | `withAuth` | Unlink a database |
| POST | `/api/jobs/:id/env-vars` | `withAuth` | Link an env var to the job |
| DELETE | `/api/jobs/:id/env-vars/:envVarId` | `withAuth` | Unlink an env var |

### Runs

| Method | Path | Wrapper | Purpose |
|---|---|---|---|
| GET | `/api/runs` | `withAuth` | Bundled `{scheduled, running, waiting, recent}`. `?filter=waiting`/`?filter=recent` for one section. `?projectId=` filter |
| POST | `/api/runs` | `withAuth` | Create a one-off run for an agent |
| GET | `/api/runs/:id` | `withAuth` | Run + activity + serialized attachments |
| DELETE | `/api/runs/:id` | `withUserAuth` | Delete run + uploads dir |
| PUT | `/api/runs/:id/status` | `withAuth` + `requireAgentOwnership` | Set run status; rejects task-runs setting `done` while task hasn't moved (409) |
| GET | `/api/runs/:id/activity` | `withAuth` | List activity entries |
| POST | `/api/runs/:id/activity` | `withAuth` + `requireAgentOwnership` | Append activity. User comments on terminal runs flip status to `pending` for resume |
| GET | `/api/runs/:id/output` | `withAuth` | Buffered output events with `?after=<id>` cursor |
| POST | `/api/runs/:id/output` | `withAuth` + `requireAgentOwnership` | Runner streams output here. Response includes `kill_requested` (piggyback) |
| GET | `/api/runs/:id/output/stream` | `withAuth` | SSE stream of output events; emits `done` on terminal status |
| GET | `/api/runs/:id/kill` | `withAuth` + `requireAgentOwnership` | Lightweight kill-flag poll for runner fallback |
| POST | `/api/runs/:id/kill` | `withUserAuth` | Request kill (sets `kill_requested_at`); 400 for non-harbour agents, 409 for non-running runs |
| POST | `/api/runs/:id/retry` | `withUserAuth` | Retry `failed`/`skipped`/`killed` → `pending` |
| PUT | `/api/runs/:id/session` | `withAuth` + `requireAgentOwnership` | Runner reports the CLI session ID + cwd for resume |

### Run attachments

| Method | Path | Wrapper | Purpose |
|---|---|---|---|
| GET | `/api/runs/:id/attachments` | `withAuth` + `requireAgentOwnership` | List attachments (serialized with absolute URLs) |
| POST | `/api/runs/:id/attachments` | `withAuth` + `requireAgentOwnership` | Upload file (multipart) or attach embed (JSON `{url}`); auto-queues video processing |
| DELETE | `/api/runs/:id/attachments/:aid` | `withAuth` + `requireAgentOwnership` | Delete one attachment |
| GET | `/api/runs/:id/attachments/:aid/file` | `withAuth` + `requireAgentOwnership` | Download bytes (inline for image/video/pdf, attachment otherwise) |
| GET | `/api/runs/:id/attachments/:aid/processing` | `withAuth` + `requireAgentOwnership` | Video processing status |
| POST | `/api/runs/:id/attachments/:aid/processing` | `withAuth` + `requireAgentOwnership` | Re-queue processing for a video attachment |
| GET | `/api/runs/:id/attachments/:aid/screenshots` | `withAuth` + `requireAgentOwnership` | Paginated list of generated frames |
| GET | `/api/runs/:id/attachments/:aid/screenshots/:index/file` | `withAuth` + `requireAgentOwnership` | One screenshot JPEG |
| GET | `/api/runs/:id/attachments/:aid/transcript` | `withAuth` + `requireAgentOwnership` | Transcript text (or interleaved storyboard if available; `?format=plain` to force) |

### Tasks

| Method | Path | Wrapper | Purpose |
|---|---|---|---|
| GET | `/api/tasks` | `withAuth` | List tasks for `?boardId=...` |
| POST | `/api/tasks` | `withAuth` | Create a card on a stage |
| GET | `/api/tasks/:id` | `withAuth` | Task + stage + activity |
| PUT | `/api/tasks/:id` | `withAuth` | Update title/description |
| DELETE | `/api/tasks/:id` | `withUserAuth` | Hard delete |
| POST | `/api/tasks/:id/archive` | `withUserAuth` | Soft archive (sets `archived_at`) |
| PUT | `/api/tasks/:id/stage` | `withAuth` + `requireTaskClaim` | Move to a new stage. 409 on illegal transitions |
| GET | `/api/tasks/:id/activity` | `withAuth` | Activity timeline with stage names resolved |
| POST | `/api/tasks/:id/activity` | `withAuth` + `requireTaskClaim` | Post comment (uses `x-harbour-run-id` header to attribute the run) |

### Task attachments

| Method | Path | Wrapper | Purpose |
|---|---|---|---|
| GET | `/api/tasks/:id/attachments` | `withAuth` | List task attachments |
| POST | `/api/tasks/:id/attachments` | `withAuth` + `requireTaskClaim` | Upload file/attach embed onto a task |
| DELETE | `/api/tasks/:id/attachments/:aid` | `withAuth` + `requireTaskClaim` | Delete one attachment |
| GET | `/api/tasks/:id/attachments/:aid/file` | `withAuth` | Download bytes |

### Boards and stages

| Method | Path | Wrapper | Purpose |
|---|---|---|---|
| GET | `/api/boards` | `withAuth` | List all boards |
| POST | `/api/boards` | `withUserAuth` | Create a board (project-scoped or top-level) |
| GET | `/api/boards/:id` | `withAuth` | Bundled `{board, stages: [{...stage, jobs_watching, tasks: [...]}]}` |
| PUT | `/api/boards/:id` | `withUserAuth` | Rename |
| DELETE | `/api/boards/:id` | `withUserAuth` | Delete |
| GET | `/api/boards/:id/stages` | `withAuth` | List stages with `jobs_watching` count |
| POST | `/api/boards/:id/stages` | `withUserAuth` | Create stage |
| PUT | `/api/boards/:id/stages` | `withUserAuth` | Bulk-update layout: `{order: [...], transitions: {fromId: [toIds]}}` |
| PUT | `/api/boards/:id/stages/:stageId` | `withUserAuth` | Update one stage (rename / set is_terminal) |
| DELETE | `/api/boards/:id/stages/:stageId` | `withUserAuth` | Delete stage. 409 if any job watches it or any task is in it |

### Docs

| Method | Path | Wrapper | Purpose |
|---|---|---|---|
| GET | `/api/docs` | `withAuth` | List docs; honors `?projectId=` |
| POST | `/api/docs` | `withAuth` | Create doc + initial revision |
| GET | `/api/docs/:id` | `withAuth` | Fetch doc with latest content |
| PUT | `/api/docs/:id` | `withAuth` | Update title and/or content (creates revision) |
| DELETE | `/api/docs/:id` | `withAuth` | Delete |
| GET | `/api/docs/:id/revisions` | `withAuth` | History list |
| POST | `/api/docs/:id/pin` | `withAuth` | Toggle pinned (auto-attach to new jobs) |

### Databases

| Method | Path | Wrapper | Purpose |
|---|---|---|---|
| GET | `/api/databases` | `withAuth` | List; honors `?projectId=` |
| POST | `/api/databases` | `withAuth` | Create a named database with columns |
| GET | `/api/databases/:id` | `withAuth` | DB + migrations + linked jobs |
| DELETE | `/api/databases/:id` | `withAuth` | Drop |
| POST | `/api/databases/:id/columns` | `withAuth` | Add a column (records a migration) |
| GET | `/api/databases/:id/rows` | `withAuth` | Paginated rows; `?limit=&offset=&orderBy=&order=ASC|DESC` |
| POST | `/api/databases/:id/rows` | `withAuth` | Insert one row or array of rows |
| PUT | `/api/databases/:id/rows/:rowId` | `withAuth` | Update one row |
| DELETE | `/api/databases/:id/rows/:rowId` | `withAuth` | Delete one row |

### Env vars

| Method | Path | Wrapper | Purpose |
|---|---|---|---|
| GET | `/api/env-vars` | `withAuth` | List env vars (no plaintext); honors `?projectId=` |
| POST | `/api/env-vars` | `withUserAuth` | Create (encrypts value) |
| GET | `/api/env-vars/:id` | `withAuth` | Fetch metadata (still no plaintext) |
| PUT | `/api/env-vars/:id` | `withAuth` | Rename or replace value |
| DELETE | `/api/env-vars/:id` | `withAuth` | Delete |
| POST | `/api/env-vars/:id/pin` | `withAuth` | Toggle pinned |
| GET | `/api/env-vars/:id/value` | `withUserAuth` | Decrypted plaintext (UI reveal) |

### Projects

| Method | Path | Wrapper | Purpose |
|---|---|---|---|
| GET | `/api/projects` | `withUserAuth` | List |
| POST | `/api/projects` | `withUserAuth` | Create (auto-creates a "Tasks" board) |
| GET | `/api/projects/:id` | `withUserAuth` | Fetch |
| PUT | `/api/projects/:id` | `withUserAuth` | Rename |
| DELETE | `/api/projects/:id` | `withUserAuth` | Delete (only the grouping; entities survive) |
| PATCH | `/api/projects/:id` | `withUserAuth` | `{action: "link"|"unlink", type: "agent"|"job"|"doc"|"env-var"|"database", targetId}` |

### Settings

| Method | Path | Wrapper | Purpose |
|---|---|---|---|
| GET | `/api/settings` | `withAuth` | All settings (sensitive ones masked) |
| PUT | `/api/settings` | `withUserAuth` | Bulk-set; sensitive masking re-applied on response |
| GET | `/api/settings/timezones` | `withAuth` | `Intl.supportedValuesOf("timeZone")` |
| GET | `/api/settings/video-processing/check` | `withUserAuth` | Probes for ffmpeg/whisper/openai/gemini availability |

### System

| Method | Path | Wrapper | Purpose |
|---|---|---|---|
| GET | `/api/system/cli-tools` | `withAuth` | Detects which of claude/codex/gemini are installed (extends PATH with common locations) |
| GET | `/api/system/upload-config` | `withAuth` | `{max_upload_mb, max_upload_bytes}` |

### Admin API keys

| Method | Path | Wrapper | Purpose |
|---|---|---|---|
| GET | `/api/admin-api-keys` | `withUserAuth` | List keys (no plaintext) |
| POST | `/api/admin-api-keys` | `withUserAuth` | Create key (returns plaintext one time) |
| DELETE | `/api/admin-api-keys/:id` | `withUserAuth` | Revoke |
| GET | `/api/admin-guide` | `withUserAuth` | Serves [ADMIN_GUIDE.md](../../ADMIN_GUIDE.md) |

### Captain

| Method | Path | Wrapper | Purpose |
|---|---|---|---|
| GET | `/api/captain/conversations` | `withUserAuth` | List the user's conversations |
| POST | `/api/captain/conversations` | `withUserAuth` | Create using captain's CLI/model/thinking settings |
| GET | `/api/captain/conversations/:id` | `withUserAuth` | Conversation + messages (with tool events grouped per assistant message) |
| PUT | `/api/captain/conversations/:id` | `withUserAuth` | Update title |
| DELETE | `/api/captain/conversations/:id` | `withUserAuth` | Stop process + delete |
| POST | `/api/captain/conversations/:id/messages` | `withUserAuth` | Post a user message; spawns CLI subprocess (202) |
| GET | `/api/captain/conversations/:id/status` | `withUserAuth` | `{running, activeMessageId}` for the chat header |
| POST | `/api/captain/conversations/:id/stop` | `withUserAuth` | SIGTERM the active CLI subprocess |
| GET | `/api/captain/conversations/:id/stream` | `withUserAuth` | SSE stream of output events |

### Workflows

| Method | Path | Wrapper | Purpose |
|---|---|---|---|
| GET | `/api/workflows/next` | `withAuth` | Polling endpoint for **agentless** workflow runs (the runner calls this from the harbour-host machine only) |

### Misc

| Method | Path | Wrapper | Purpose |
|---|---|---|---|
| GET | `/api/users` | `withAuth` | List users (id + display name + email) |
| GET | `/api/guide` | (none — public) | Serves [GUIDE.md](../../GUIDE.md) |

## When to read which file

| Question | File |
|---|---|
| "What does the runner curl after a kill?" | `bin/lib/runner.mjs:426-455` |
| "What exact JSON does `/api/agents/:id/next` return?" | [GUIDE.md](../../GUIDE.md) |
| "What can an admin key do that a user session can't?" | Nothing — admin keys resolve to a user identity |
| "What's the agent ownership rule?" | `src/lib/auth.ts:90-96` |
| "What happens when a task move violates a transition?" | `src/app/api/tasks/[id]/stage/route.ts` returns 409 |
| "What schema does the `data` block in `/next` follow?" | [GUIDE.md](../../GUIDE.md) — agent-managed table rows by name |
| "How do I add a new route?" | New `route.ts` under `src/app/api/<path>/`; wrap with `withAuth` or `withUserAuth`; add a row to the relevant table above |
