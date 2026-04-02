# Harbour

A control plane for AI agents doing ongoing work.

![Harbour Dashboard](public/screenshot.png)

## Why

AI agents can handle real, ongoing responsibilities — marketing, support, dev. They post content, triage tickets, manage campaigns, submit PRs. Most of this runs on recurring schedules.

The problem is visibility. What jobs does each agent have? What ran today? What needs my attention? What broke?

Harbour is the layer underneath your agents — managing what recurring work each has, giving them shared context through docs and data, and surfacing the things that need you.

## How It Works

Harbour is a polling-based control plane. It never calls out to agents — they pull work on their own schedule.

**Jobs** are recurring responsibilities with a schedule, instructions, and references to docs, data, and env vars. When a job fires, it creates a **run**. Agents poll for runs, do the work, post updates, and set a final status — or set it to **waiting** if they need human input.

**Docs** are shared markdown documents (brand guidelines, processes, strategy) injected into runs automatically. **Databases** are SQLite tables agents create and manage through the API, also injected into runs. **Env Vars** are encrypted key-value pairs (API keys, tokens) decrypted and injected at runtime.

### The `/next` Endpoint

All agents — harbour and external — get work through `GET /api/agents/:id/next`. The response bundles everything: run context, job instructions, docs, database rows, env vars, and an `api` section with pre-resolved endpoints and status options for the run. Agents use `?peek=true` to check for work without claiming it.

## Getting Started

```bash
git clone https://github.com/geekforbrains/harbour.git
cd harbour
npm install
npm run build
npm start
```

Visit [http://localhost:3000](http://localhost:3000) and create your first account.

### Harbour Agents

Built-in support for running agents via [Claude Code](https://claude.ai/claude-code), [Codex](https://github.com/openai/codex), or [Gemini CLI](https://github.com/google-gemini/gemini-cli). A local runner polls for work, spawns your CLI tool, streams output to the dashboard, and posts the result as run activity.

1. Dashboard → **New Agent** → select **Harbour Agent** and pick your CLI tool
2. Name it, pick a model and thinking/effort level, create a job with a schedule and instructions
3. Install the runner:

```bash
npm run harbour -- agent install
```

The runner polls every 60 seconds. All configured agents run concurrently. Logs go to `~/.harbour/runner.log`.

```bash
npm run harbour -- agent list        # show configured agents
npm run harbour -- agent run         # manual poll (useful for testing)
npm run harbour -- agent uninstall   # stop the runner
```

The runner injects the Harbour API credentials and endpoints into each prompt, so harbour agents can set run status (`done`, `waiting`, `failed`), post activity messages, and manage docs and databases — just like external agents. If an agent doesn't set a final status, the runner marks the run as failed.

Model and thinking/effort levels can be set per agent (default) and overridden per job — letting you use a lighter model for routine tasks and a heavier one for complex work.

### External Agents

Any tool that can poll an HTTP endpoint works — [OpenClaw](https://openclaw.ai), custom scripts, or any agent framework.

1. Dashboard → **New Agent** → select **External** to get an API key
2. Create a job with a schedule and instructions
3. Copy the invite text into your agent's system prompt

The invite includes credentials and the polling loop. The `/next` endpoint provides everything the agent needs, including the API reference for the current run.

## Admin API Keys

Admin API keys give external agents full management access to Harbour — creating agents, jobs, runs, docs, databases, env vars, and modifying settings. This is how you let a separate AI assistant help you operate Harbour remotely.

1. Dashboard → **Settings** → **Admin API Keys** → **New Key**
2. Name it, copy the invite text (includes key, URL, and bootstrap instructions)
3. Paste the invite into your management agent's conversation

The invite tells the agent to fetch `GET /api/admin-guide` with its key, which returns the full admin API reference. Admin keys resolve to the creating user's identity for audit trails.

Admin API documentation is served at `/api/admin-guide` and maintained in [ADMIN_GUIDE.md](ADMIN_GUIDE.md).

## Agent API

```
GET  /api/agents/:id/next           — get next run (or nothing)
GET  /api/agents/:id/next?peek=true — check for work without claiming it
PUT  /api/runs/:id/status           — update run status
POST /api/runs/:id/activity         — add to the run's activity log
POST /api/runs/:id/retry            — retry a failed/skipped run
POST /api/docs                      — create a doc
PUT  /api/docs/:id                  — update a doc
POST /api/databases                 — create a database
POST /api/databases/:id/rows        — insert rows
GET  /api/databases/:id/rows        — read rows (paginated)
GET  /api/guide                     — full API guide
```

Full API documentation is served at `/api/guide` and maintained in [GUIDE.md](GUIDE.md).

## Run Lifecycle

```
scheduled → running → done
                    → failed
                    → skipped (pre-run check)
                    → waiting (needs human) → pending (human responded) → running → ...
```

Failed and skipped runs can be retried from the dashboard — the run goes back to `pending` and the agent picks it up on next poll.

`waiting` runs do not block the job from firing again on schedule. New runs continue normally while a run is waiting for human input.

## Projects

Projects are an optional way to organize your work. They're a view layer — a bag of references to agents, jobs, docs, env vars, and databases. They don't own anything; entities live at the top level and can belong to multiple projects (or none).

- Create projects from the sidebar dropdown (desktop) or the header (mobile)
- Switch between projects to filter all pages, or view "All Projects" to see everything
- When viewing a project, "Add Existing" buttons let you attach existing items
- Creating new items while in a project auto-links them
- Adding a job to a project auto-links its agent, docs, env vars, and databases
- Manage projects (rename, delete) in Settings while viewing a project
- Deleting a project only removes the grouping — nothing else is affected

## Dashboard

- **Runs** — running, scheduled, waiting, pending, and recent runs. Create one-off runs or recurring jobs from a unified dialog.
- **Jobs** — recurring jobs across agents, with run/skip counts, schedules, and linked docs/env vars.
- **Agents** — list of agents with jobs, activity, and poll status. Harbour agents show CLI tool, model, and thinking level.
- **Docs** — shared knowledge base, editable by humans and agents. Pin docs to auto-attach to all new jobs.
- **Databases** — read-only view of agent-managed SQLite tables.
- **Env Vars** — encrypted variables (API keys, tokens) injected at runtime. Pin to auto-attach to all new jobs.
- **Settings** — system timezone, signup control, project management, and admin API keys.

Available as a PWA — add to your home screen on mobile for a native app experience.

## Tech Stack

Next.js (App Router), SQLite (better-sqlite3), Tailwind / shadcn/ui, TypeScript. Single binary-style deployment — no external database, no Redis, no background workers. Just `npm start`.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `HARBOUR_DB_PATH` | SQLite database file path | `./harbour.db` |
| `HARBOUR_ENCRYPTION_KEY` | 64-char hex key for env var encryption | Auto-generated at `~/.harbour/encryption.key` |

## License

[MIT](LICENSE)
