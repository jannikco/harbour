import fs from "fs";
import path from "path";
import { getDb } from "@/lib/db/schema";
import { createAgent, createJob, getJobById } from "@/lib/db/queries";
import { saveRunnerConfig } from "@/lib/runners";
import { harbourHome, ensureDir } from "@/lib/paths";

const PROCESSOR_AGENT_NAME = "Inspirations Processor";
const PROCESSOR_JOB_NAME = "Process inspiration queue";
const WORKFLOW_SCRIPT_NAME = "inspiration-fetch.mjs";

const PROCESSOR_INSTRUCTIONS = `You are a LinkedIn content analyst working through a queue of other people's posts the operator wants to learn from.

The workflow gate has already fetched one LinkedIn post using a logged-in Playwright session and emitted a JSON object on stdout that you will find in the **Workflow Output** section of this run. The shape is:

\`\`\`
{ "inspiration_post_id": "...", "url": "...", "author": "...", "author_url": "...", "posted_at_text": "...", "text": "...", "image_urls": [...], "reactions": 123, "comments": 45 }
\`\`\`

Use any **Voice & Style** docs attached to this run to capture how the operator writes.

Produce four artifacts:

1. **analysis** — a tight breakdown of why this post worked (hook, structure, voice, audience, the move it's pulling). Markdown, ~6–10 lines.
2. **post_draft** — an original LinkedIn post in the operator's voice that's *inspired by* the source — never a copy, never a paraphrase. New angle, new opener, new payoff. Markdown.
3. **reply_draft** — a substantive comment the operator could leave on the source post. Adds a real point of view, not "great post 👏". 2–5 sentences.
4. **topic_ideas** — 3–5 angles the operator could write about, each one sentence.

Write the result back with a single API call:

\`\`\`
PATCH {base_url}/api/inspirations/{inspiration_post_id}
Authorization: Bearer {your api key}
Content-Type: application/json

{
  "status": "done",
  "analysis": "...",
  "post_draft": "...",
  "reply_draft": "...",
  "topic_ideas": ["...", "...", "..."]
}
\`\`\`

Then mark the run done:

\`\`\`
PUT {base_url}/api/runs/{run_id}/status
{ "status": "done" }
\`\`\`

If anything goes wrong (no workflow output, parse failure, etc.), PATCH the same inspiration with \`{ "status": "failed", "error": "<short reason>" }\` and PUT run status to "failed". Do not retry — the operator can hit Retry from the dashboard.`;

function workflowsDir(): string {
  return path.join(harbourHome(), "workflows");
}

function workflowScriptDest(): string {
  return path.join(workflowsDir(), WORKFLOW_SCRIPT_NAME);
}

function repoScriptSrc(): string {
  return path.join(process.cwd(), "bin", "linkedin", WORKFLOW_SCRIPT_NAME);
}

function findExistingAgent(name: string): { id: string } | null {
  const db = getDb();
  const row = db.prepare(`SELECT id FROM agents WHERE name = ? LIMIT 1`).get(name) as { id: string } | undefined;
  return row || null;
}

function findExistingJob(agentId: string, name: string): { id: string } | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT id FROM jobs WHERE agent_id = ? AND name = ? AND one_off = 0 LIMIT 1`)
    .get(agentId, name) as { id: string } | undefined;
  return row || null;
}

function installWorkflowScript() {
  const dest = workflowScriptDest();
  if (fs.existsSync(dest)) return;
  ensureDir(workflowsDir());
  const src = repoScriptSrc();
  if (!fs.existsSync(src)) {
    throw new Error(`workflow script missing at ${src}`);
  }
  fs.copyFileSync(src, dest);
}

export type EnsureProcessorResult = {
  agentId: string;
  jobId: string;
  created: boolean;
};

/**
 * Ensure the dedicated "Inspirations Processor" harbour agent + its drainer
 * job exist. Idempotent — safe to call on every paste. On first call, creates
 * the agent (Claude Code, eager polling on), writes the runner config so the
 * local runner picks it up, installs the Playwright fetch script to
 * ~/.harbour/workflows/, and creates the recurring job.
 */
export function ensureInspirationsProcessor(baseUrl: string): EnsureProcessorResult {
  const existingAgent = findExistingAgent(PROCESSOR_AGENT_NAME);

  if (existingAgent) {
    // Ensure the job exists too — agent might have been left without one
    const existingJob = findExistingJob(existingAgent.id, PROCESSOR_JOB_NAME);
    if (existingJob) {
      installWorkflowScript();
      return { agentId: existingAgent.id, jobId: existingJob.id, created: false };
    }

    installWorkflowScript();
    const job = createJob(existingAgent.id, {
      name: PROCESSOR_JOB_NAME,
      description: "Drains the LinkedIn inspirations queue. Fetches each queued post via Playwright, generates analysis + drafts, writes back.",
      instructions: PROCESSOR_INSTRUCTIONS,
      schedule: "*/2 * * * *",
      workflowCommand: `node ${WORKFLOW_SCRIPT_NAME}`,
      workflowOnly: false,
    });
    return { agentId: existingAgent.id, jobId: job!.id, created: false };
  }

  // First-time: create agent, save runner config, install script, create job
  const agent = createAgent(PROCESSOR_AGENT_NAME, "Auto-managed by the Inspirations feature. Drains the queue of LinkedIn posts to analyze.", {
    type: "harbour",
    cli: "claude",
    remote: false,
    eager: true,
  });

  saveRunnerConfig({
    agentId: agent.id,
    name: agent.name,
    apiKey: agent.apiKey,
    cli: "claude",
    model: null,
    thinking: null,
    eager: true,
    url: baseUrl,
  });

  installWorkflowScript();

  const job = createJob(agent.id, {
    name: PROCESSOR_JOB_NAME,
    description: "Drains the LinkedIn inspirations queue. Fetches each queued post via Playwright, generates analysis + drafts, writes back.",
    instructions: PROCESSOR_INSTRUCTIONS,
    schedule: "*/2 * * * *",
    workflowCommand: `node ${WORKFLOW_SCRIPT_NAME}`,
    workflowOnly: false,
  });

  return { agentId: agent.id, jobId: job!.id, created: true };
}

export function getInspirationsProcessorAgent(): { id: string; name: string } | null {
  const db = getDb();
  const row = db.prepare(`SELECT id, name FROM agents WHERE name = ? LIMIT 1`).get(PROCESSOR_AGENT_NAME) as
    | { id: string; name: string }
    | undefined;
  return row || null;
}

export function getInspirationsProcessorJob(): { id: string; agent_id: string } | null {
  const agent = getInspirationsProcessorAgent();
  if (!agent) return null;
  const job = findExistingJob(agent.id, PROCESSOR_JOB_NAME);
  if (!job) return null;
  const full = getJobById(job.id);
  return full as { id: string; agent_id: string } | null;
}
