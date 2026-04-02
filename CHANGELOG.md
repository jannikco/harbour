# Changelog

## v1.4.1 — 2026-04-02

### Fix
- `waiting` runs no longer block a job from firing on its next scheduled interval — new runs are created normally while a run is waiting for human input

## v1.4.0 — 2026-04-02

### Admin API Keys
- Admin API keys for external agents to manage Harbour remotely with full user-level access
- Create and revoke keys from Settings page, each with a name and last-used tracking
- Key shown once on creation as a copyable invite snippet with URL and bootstrap instructions
- Admin keys resolve to the creating user's identity for audit trails
- Admin guide served at `/api/admin-guide` — full API reference for management agents
- Keys prefixed `hbr_adm_`, stored as SHA-256 hash (never plaintext)

### Projects
- Optional projects for organizing work — a view layer over agents, jobs, docs, env vars, and databases
- Project switcher in sidebar (desktop) and header (mobile) with create/switch/all views
- "Add Existing" buttons on all list pages when viewing a project
- Auto-link: creating items while in a project links them automatically
- Auto-link dependencies: adding a job to a project pulls in its agent, docs, env vars, and databases
- Project settings in Settings page — rename and delete (with confirmation)
- All list API endpoints accept optional `?projectId=` filter
- Deleting a project only removes grouping — no entities are affected

## v1.3.0 — 2026-04-01

### Jobs
- Trigger run button — instantly start a run for any job (paused or active) with confirmation dialog
- Per-job CLI timeout — runner uses each job's `timeout_minutes` setting instead of a hardcoded 10-minute limit
- Re-activating a paused job now computes `next_run_at` from the schedule

### Runs
- Comment on done/failed runs to reopen them as pending — continues the conversation with the agent
- Reply form visible on waiting, pending, done, and failed runs (hidden for running/scheduled/skipped)
- Sanitized error output — timeout and crash errors now show a human-readable reason instead of raw streaming JSON protocol lines
- Output section hidden for external agent runs (only shown for harbour agents)

### Runner
- Pre-run check commands now execute as shell processes — the runner runs the command directly, pipes the full payload JSON to stdin, and appends stdout to the prompt (exit 0 = proceed, exit 1 = skip, exit 2+ = error)
- CLI tool detection uses extended PATH (homebrew, .local/bin, npm-global) for version checks

### Settings
- Configurable "Recent Runs Shown" limit — controls how many completed runs display on the main Runs page (default: 10)

### UI
- Version number shown in sidebar footer and mobile More menu

## v1.2.0 — 2026-03-31

### Environment Variables
- Encrypted env vars (AES-256-GCM) with key stored at `~/.harbour/encryption.key`
- Create, edit, delete env vars from the dashboard with eye-toggle to reveal values
- Pin env vars to auto-attach to all new jobs and one-off runs
- Link env vars to jobs (same pattern as docs)
- Decrypted values injected into `/next` payload as `env` object
- Runner injects env vars into agent prompts as named credentials
- Supports `HARBOUR_ENCRYPTION_KEY` env var override

### Settings
- New Settings page with system-wide configuration
- Timezone: auto-detected from system on first run, searchable dropdown of all IANA timezones
- Timezone used in all schedule calculations and time display
- Signup toggle: enable/disable new user registration

### Per-Job Model & Thinking
- Model and thinking/effort level configurable per agent (default) and per job (override)
- CLI-specific options: Claude (effort: low/medium/high/max), Codex (reasoning: low/medium/high), Gemini (thinking: low/medium/high)
- Agent detail page shows type, CLI tool, model, and thinking level
- Runner reads job-level overrides from `/next` payload, falls back to agent defaults
- Model/thinking changes synced to `~/.harbour/runners.json`

### Unified Create Dialog
- Single "New Run / New Job" dialog with tabs, shared fields persist when switching
- Both tabs support docs and env vars selection with picker sub-dialogs
- Pinned docs and env vars auto-selected on dialog open
- Model and thinking selectors shown for harbour agents on both tabs
- Replaces separate New Run and New Job dialogs on their respective pages

### Pinned Docs
- Pin/unpin toggle on docs list and detail views
- Pinned docs appear at top of docs list
- Pinned docs auto-attached to all new jobs and one-off runs
- Can still be manually removed from individual jobs

### Run Improvements
- Retry button on failed/skipped runs (sets status to pending, agent picks up on next poll)
- View Job button always visible on run detail (including one-off runs)
- Live streaming output from harbour agent CLI runs

### Job Detail Improvements
- Docs section with proper card layout and add dialog (replaces inline dropdown)
- Env vars section with same pattern
- Databases section with card layout

### UI Polish
- Consistent empty states with centered icons matching nav menu across all views
- Agent detail shows type (Harbour/External), CLI tool badge, model, and thinking level
- Invite and API key buttons only shown for external agents
- Error feedback on all dashboard mutation operations

### Runner Reliability
- Startup timeout (30s) kills hung CLI processes (e.g. unauthenticated Gemini)
- Stdin closed immediately to prevent interactive prompt hangs
- Stderr included in error activity logs for better diagnostics

### Security & Code Quality
- `withAuth`/`withUserAuth` higher-order function wrappers replace manual auth boilerplate across all 36 API routes
- Agent ownership enforcement: agents can only act on their own resources (runs, status, activity, output)
- `orderBy` parameter validated against actual column names in database rows endpoint
- Composite indexes on `jobs(agent_id, active, next_run_at)` and `run_activity(run_id, created_at)`
- `getAgentNextRun()`, `createJob()`, and `createOneOffRun()` wrapped in transactions for atomicity
- Deduplicated `advanceSchedule` — single implementation in `jobs.ts`
- Shared `ModelThinkingSelect` component replaces 4 duplicate select blocks

## v1.1.0 — 2026-03-30

### Harbour Agents
- Built-in agent runner for Claude Code, Codex, and Gemini CLI
- New Agent dialog: choose **Harbour Agent** (local CLI) or **External** (bring your own)
- Auto-detect installed CLI tools with version display
- CLI badge on agent list items, "Runner not active" banner
- Runner config auto-saved to `~/.harbour/runners.json` on creation, cleaned up on deletion
- `npm run harbour -- agent install` sets up a macOS launch agent (launchd) for automatic polling
- `npm run harbour -- agent list/run/uninstall` for runner management
- Session tracking for CLI tool conversation resumption across runs
- Providers: Claude (`--dangerously-skip-permissions`), Codex (`--dangerously-bypass-approvals-and-sandbox`), Gemini (`--yolo`)

### Schema
- Agents table: added `type` (harbour/external), `cli`, `model` columns with auto-migration

## v1.0.0 — 2026-03-30

Initial public release.

### Core
- Agent registration with API keys and invite system
- Job scheduling (intervals and weekly) with pre-run checks
- Run lifecycle: scheduled, running, waiting, pending, done, failed, skipped
- One-off runs created from the dashboard
- Configurable job timeouts with automatic stale run cleanup
- Docs system with revision history, linked to jobs
- Agent-managed databases with schema migrations, linked to jobs

### Dashboard
- PWA-ready responsive UI (mobile + desktop)
- Runs view with running, scheduled, waiting, pending, and recent sections
- Jobs view with run/skip counts
- Agent management with invite text and key rotation
- Doc editor with revision history
- Database browser

### Agent API
- Polling-based work distribution (`/next` and `?peek`)
- Activity logging with markdown support
- Human-in-the-loop via waiting/pending flow
- Full CRUD for docs and databases
- Self-serve API guide at `/api/guide`
