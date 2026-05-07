# Architecture

A 30-minute orientation for someone digging in. Not exhaustive — pointer-rich.

## Overview

Harbour is a **single Next.js process** plus a **single SQLite file**. There is no Redis, no message queue, no separate worker pool. Recurring jobs become rows in `runs` with `status='scheduled'`; an agent (or workflow runner) polls an HTTP endpoint to claim work. State changes happen inside SQLite transactions, so the run-claim path is atomic without external coordination.

Everything an installation needs lives under one directory — by default `~/.harbour/`:

| Path | Contents |
|---|---|
| `harbour.db` (+ `-wal`, `-shm`) | SQLite database (WAL mode) |
| `encryption.key` | 64-char hex key for env var AES-256-GCM |
| `uploads/runs/<runId>/` | Run attachment files |
| `uploads/tasks/<taskId>/` | Task attachment files |
| `runners.json` | Local runner config (agent → CLI tool mapping) |
| `sessions.json` | CLI session ID cache for run resume |
| `workflows/` | User-supplied scripts invoked by workflow jobs |
| `captain/` | Captain conversation workspace (default cwd) |
| `runner.log`, `runner.err.log` | launchd output for the agent runner |

Override roots via `HARBOUR_HOME`, `HARBOUR_DB_PATH`, `HARBOUR_UPLOADS_DIR`, `HARBOUR_ENCRYPTION_KEY`, `HARBOUR_MAX_UPLOAD_MB` (default 500). See `src/lib/paths.ts:19-63`.

## Tech stack

Versions pulled directly from `package.json` at v1.14.0:

| Layer | Choice | Version |
|---|---|---|
| Framework | Next.js (App Router) | 16.2.1 |
| UI runtime | React | 19.2.4 |
| Styling | Tailwind | ^4 (with `@tailwindcss/postcss`) |
| Components | shadcn/ui (built on `@base-ui/react`) | shadcn ^4.1.1 |
| DB driver | better-sqlite3 | ^12.8.0 |
| Auth hashing | bcryptjs | ^3.0.3 |
| JWT/JOSE | jose | ^6.2.2 |
| Client state | TanStack Query | ^5.95.2 |
| DnD (kanban) | @dnd-kit/core, @dnd-kit/sortable | ^6.3.1 / ^10.0.0 |
| Markdown | react-markdown + remark-gfm + marked | ^10.1.0 / ^4.0.1 / ^17.0.5 |
| Multipart upload | busboy | ^1.6.0 |
| Tests | Vitest | ^4.1.2 |
| Browser tests | @playwright/test | ^1.58.2 |
| Linting | ESLint 9 + eslint-config-next | ^9 / 16.2.1 |
| TypeScript | typescript | ^5 |

The repo ships a tiny CLI: `npm run harbour -- ...` resolves to `bin/harbour.mjs` (75 lines), which dispatches to the runner library under `bin/lib/`.

## Auth model

Three principals authenticate against the API:

1. **User session** — login at `/login`, sets the `harbour_session` cookie (HttpOnly, SameSite=Lax, 30 days). Sessions live in the `sessions` table. Created at `src/app/api/auth/login/route.ts`.
2. **Agent API key** — bearer token in `Authorization: Bearer <key>`. Stored bcrypt-hashed in `agents.api_key_hash`. Each agent has exactly one key; rotated via `POST /api/agents/:id/rotate-key`.
3. **Admin API key** — bearer token, but resolves to a **user identity** (the creator's `user_id`). Stored hashed in `admin_api_keys`. Lets an external operator agent act as a user.

Every route is wrapped in one of two HOFs from `src/lib/auth.ts`:

| Wrapper | Accepts | Source |
|---|---|---|
| `withAuth(handler)` | user OR agent OR admin key | `src/lib/auth.ts:57-65` |
| `withUserAuth(handler)` | user OR admin key (not agent) | `src/lib/auth.ts:67-78` |

Inside a `withAuth` handler, two extra guards are used for finer-grained scope:

- **`requireAgentOwnership(auth, agentId)`** — when the auth principal is an agent, asserts it owns the resource (matches `agentId`). Returns 403 otherwise; users always pass through. `src/lib/auth.ts:90-96`.
- **`requireTaskClaim(auth, taskId, hasActiveClaim)`** — agents can only mutate a task they currently have an active claim on (via a running run). `src/lib/auth.ts:103-113`. Used by `tasks/:id/stage`, `tasks/:id/activity`, `tasks/:id/attachments`.

There are **no** inline auth checks anywhere in `src/app/api/`; the wrappers are mandatory.

## Polling ladder

When a runner POSTs to `GET /api/agents/:id/next`, the server runs a five-step priority ladder inside one transaction. The ladder is in `src/lib/db/runs.ts:287-397` (`getAgentNextRun`). Steps fall through if they don't match.

```
Step 0  Fail any 'running' runs that exceeded job.timeout_minutes (failStaleRuns)
Step 1  Agent already has a 'running' run? -> return null (busy)
Step 2  'pending' run for this agent? -> flip to 'running', return it
Step 3  'scheduled' run with scheduled_for <= now? -> claim, return it
Step 4  Recurring schedule-triggered job past next_run_at? -> create run, advance schedule
Step 5  Task-stage-triggered job with an unclaimed task in the watched stage?
        -> insert run, atomically CAS-claim the task (loser deletes its run)
```

**Atomicity.** The whole sequence is a `db.transaction(() => ...)`. If two parallel polls reach step 5 with the same task, the `UPDATE tasks SET claimed_by_run_id=? WHERE id=? AND claimed_by_run_id IS NULL` is the lock — one wins (1 row affected), the other deletes its just-inserted run. See `src/lib/db/tasks.ts` (`claimTaskForRun`) and `src/lib/db/runs.ts:367-389`.

**Workflow-only counterpart.** `getNextWorkflowRun()` at `src/lib/db/runs.ts:400-499` runs the same shape for agentless `workflow_only=1` jobs (no agent_id), exposed at `GET /api/workflows/next`.

## Run lifecycle

```
                                +-- failed (terminal)
                                |
                                +-- skipped (terminal; workflow exit 77)
                                |
                                +-- killed (terminal; SIGTERM, resumable via comment)
scheduled --> running ----------+
   ^             |              |
   |             +-- waiting -- pending --> running --> ...
   |                                ^
   +-- (never reached on terminal)  +-- comment from user on
                                        waiting/done/failed/killed
```

- **`scheduled`** — created by `triggerJobRun` (one-off) with a future `scheduled_for`, or by a job's recurring schedule.
- **`running`** — the runner has claimed it. Sets `claimed_at`. While in `running`, the job's other queued runs sit behind it.
- **`waiting`** — the agent paused, asked for human input.
- **`pending`** — a human responded (commented or retried). Step 2 of the polling ladder picks it up next.
- **`done` / `failed` / `skipped` / `killed`** — terminal. Sets `completed_at`. `done`/`failed`/`skipped` advance the job's `next_run_at`; `killed` does **not** (the user stopped it intentionally).

Status transitions are validated at `src/lib/db/runs.ts:44-53` (`validateRunStatusTransition`). The notable check: a task-triggered run cannot reach `done` while its task is still in the watched stage — otherwise the same job would pick it up forever. Returns 409 from `PUT /api/runs/:id/status`.

### The kill flow

The dashboard's **Kill** button writes `runs.kill_requested_at = unixepoch()`. The runner notices this **two ways**:

1. **Piggyback** — the runner POSTs streaming output to `/api/runs/:id/output` every ~750ms while the CLI is talking. Each response includes `kill_requested: <bool>`. When true, the runner aborts the child process. Latency: ≤ one flush cycle.
2. **Fallback poll** — if the CLI is silent (long thinking stretch, no output), the runner GETs `/api/runs/:id/kill` every 10s as a safety net.

The handlers live at `src/app/api/runs/[id]/output/route.ts:38` (piggyback) and `src/app/api/runs/[id]/kill/route.ts:18` (poll). The runner code is in `bin/lib/runner.mjs:426-455`. After SIGTERM, the runner saves the CLI session ID to `sessions.json` so a comment on the killed run can resume it from where it left off.

## Runner architecture

The runner is a **separate Node CLI** invoked by launchd every 60 seconds (macOS only at the moment). It is not run by the Next.js process.

```
launchd (com.harbour.agent-runner, StartInterval=60)
    |
    +--> node bin/harbour.mjs agent run
              |
              +--> bin/lib/runner.mjs : runAgents()
                      for each runner in ~/.harbour/runners.json:
                        GET /api/agents/:id/next        --> spawn CLI
                      if any runner.url is local:
                        GET /api/workflows/next         --> spawn shell
```

Key files:

| File | Role |
|---|---|
| `bin/harbour.mjs` | CLI dispatcher: `start | dev | agent {list,run,connect,install,uninstall}` |
| `bin/lib/runner.mjs` | Polling loop, prompt assembly, kill plumbing, session save (809 lines) |
| `bin/lib/providers.mjs` | Per-CLI provider (claude / codex / gemini) — command building, JSONL parsing, kill-grace SIGTERM/SIGKILL (519 lines) |
| `bin/lib/install.mjs` | launchd plist install/uninstall |
| `bin/lib/connect.mjs` | Decode the `harbour agent connect <blob>` and write a runner config |
| `bin/lib/config.mjs` | Read/write `~/.harbour/runners.json` and `~/.harbour/sessions.json` |

The runner streams CLI output to the server in batches (750 ms flush). All three providers emit normalized event types: `text_delta`, `tool_start`, `tool_end`, `thinking`, `info`, `error`, `result`. Frontend consumes these via SSE at `/api/runs/:id/output/stream`.

Workflow-only jobs are handled in the same poll cycle (`runAgentlessWorkflows`); only the runner whose `url` resolves to `localhost`/`127.0.0.1` picks those up — see `bin/lib/runner.mjs:771-806`. Remote runners deliberately skip the agentless workflow queue because the workflow scripts live on the harbour host.

## Frontend layout

The App Router has two route groups:

- **`src/app/(auth)/`** — `login/`, `signup/`. Public routes; no shell.
- **`src/app/(app)/`** — everything inside the dashboard. Wrapped in `AppShell`.
  - `agents/`, `board/`, `captain/`, `databases/`, `docs/`, `env-vars/`, `jobs/`, `runs/`, `settings/`, `users/`
  - `page.tsx` — root dashboard (today's runs)
  - `layout.tsx` — `<AppShell>` wrapper

`AppShell` (`src/components/app/app-shell.tsx`) handles auth check, project state (localStorage `harbour_active_project`), sidebar/mobile navigation, and theme. It exposes `AppContext` so any descendant can read `{ user, projects, activeProjectId }` via `useApp()`.

### React Query refetch policies

The `QueryClient` defaults at `src/components/providers/query-provider.tsx:7-13`:

```
staleTime: 2000
refetchOnWindowFocus: true
```

Per-query overrides are common throughout the app:

| Surface | `refetchInterval` | Notes |
|---|---|---|
| Sidebar projects (`AppShell`) | 10 s | `app-shell.tsx:61` |
| Most list pages (runs, jobs, agents, docs) | 5 s | quick feedback during runs |
| Boards index | 10 s | `board/page.tsx:88` |
| Active board (single-board view) | 5 s | `board/page.tsx:244` |
| Lookup queries (e.g. CLI tools, doc list in dialogs) | none, `staleTime: 60_000` | rarely change |

Detail pages (run, agent, doc, database row table) typically poll at 5 s; SSE streams (run output, captain output) replace the poll once an agent is actually streaming.

## File layout

```
src/
  app/
    (auth)/             user-facing login/signup
    (app)/              dashboard pages (one folder per nav item)
    api/                79 route.ts files (123 HTTP method handlers)
    layout.tsx          root layout, theme bootstrap
  components/
    app/                AppShell, dialogs, run-status, kanban tiles
    ui/                 shadcn primitives (button, dialog, etc.)
    providers/          QueryProvider
  lib/
    db/                 schema + per-table query modules (18 files)
    captain/            spawn/stop a CLI subprocess for in-browser chat
    auth.ts             withAuth, withUserAuth, requireAgentOwnership, requireTaskClaim
    encryption.ts       AES-256-GCM for env vars
    schedule.ts         schedule parsing + tz-aware next_run_at math
    paths.ts            HARBOUR_HOME-rooted file paths
    runners.ts          runners.json read/write
    cli-config.ts       per-CLI model and thinking options
    upload.ts           busboy multipart receive
    video-processing.ts ffmpeg + whisper screenshots/transcripts
    request-url.ts      reverse-proxy-aware base URL resolution
bin/
  harbour.mjs           CLI entry
  lib/                  runner, providers, install, config, connect (5 files, ~1573 lines)
docs/
  concepts/             mental-model writeups
  guides/               step-by-step setup
  reference/            this folder (architecture, schema, API)
GUIDE.md                served at GET /api/guide; agent wire contract
ADMIN_GUIDE.md          served at GET /api/admin-guide; admin-key wire contract
CHANGELOG.md            release history
terraform/              DigitalOcean droplet config
```

## Source-of-truth pointers

A new contributor should read these in order:

1. `src/lib/db/schema.ts` — every table, every migration. The file evolves; all schema lives here.
2. `src/lib/auth.ts` — auth model (~120 lines, full picture).
3. `src/lib/db/runs.ts` — the polling ladder, the kill request flow, and run lifecycle in one file.
4. `src/lib/db/tasks.ts` — claim/release CAS, the move-before-done helper.
5. `src/lib/db/jobs.ts` — schedule advance, job creation transactions, watched-stage validation.
6. `src/app/api/agents/[id]/next/route.ts` — the server side of agent polling, including the `api` section that travels with each payload.
7. `bin/lib/runner.mjs` — the client side of polling, prompt assembly, and the kill flow.
8. `bin/lib/providers.mjs` — Claude/Codex/Gemini command building and stream parsing.
9. `src/components/app/app-shell.tsx` — frontend chrome and project filtering.
10. `GUIDE.md` and `ADMIN_GUIDE.md` — wire contracts; live-served on `/api/guide` and `/api/admin-guide`.
11. `src/lib/schedule.ts` — interval / weekly schedule parsing and timezone math.
12. `docs/concepts/boards-and-tasks.md` — the design rationale for the kanban contract (paired reading with `tasks.ts`).
