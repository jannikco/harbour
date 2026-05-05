import { getDb } from "./schema";
import { v4 as uuid } from "uuid";
import { getDecryptedEnvVarsForJob } from "./env-vars";
import { advanceJobSchedule } from "./jobs";
import { listAttachmentsByRun, deleteRunAttachmentsDir } from "./attachments";
import { listTaskActivity, releaseTaskForRun, isTaskMovedFromWatchedStage, claimTaskForRun } from "./tasks";
import { getLegalTransitions } from "./stages";

export function createRun(jobId: string, agentId: string | null, taskId?: string | null) {
  const db = getDb();
  const id = uuid();
  db.prepare(`
    INSERT INTO runs (id, job_id, agent_id, status, claimed_at, task_id)
    VALUES (?, ?, ?, 'running', unixepoch(), ?)
  `).run(id, jobId, agentId || null, taskId || null);
  return getRunById(id);
}

export function getRunById(id: string) {
  const db = getDb();
  const run = db.prepare(`
    SELECT r.*, j.name as job_name, j.one_off, j.workflow_only as job_workflow_only, j.agent_id, j.trigger_kind as job_trigger_kind, j.watched_stage_id as job_watched_stage_id, a.name as agent_name, a.type as agent_type, a.cli as agent_cli, t.title as task_title
    FROM runs r
    JOIN jobs j ON r.job_id = j.id
    LEFT JOIN agents a ON r.agent_id = a.id
    LEFT JOIN tasks t ON r.task_id = t.id
    WHERE r.id = ?
  `).get(id) as any;
  return run || null;
}

export function getRunWithActivity(id: string) {
  const run = getRunById(id);
  if (!run) return null;
  const activity = listRunActivity(id);
  return { ...run, activity };
}

/**
 * Validate that a run can move to the given status. Returns null if OK, or an
 * error message string. Used by the status API route to reject 'done' for
 * task-triggered runs that haven't moved their task yet.
 */
export function validateRunStatusTransition(id: string, status: string): string | null {
  const existing = getRunById(id);
  if (!existing) return "run not found";
  if (status === "done" && existing.task_id) {
    if (!isTaskMovedFromWatchedStage(id)) {
      return "Task is still in the watched stage. Move the task to a new stage before marking this run done, or set status to 'failed' if you couldn't complete it.";
    }
  }
  return null;
}

export function updateRunStatus(id: string, status: string) {
  const db = getDb();
  const existing = getRunById(id);
  const completedAt = (status === "done" || status === "failed" || status === "skipped" || status === "killed")
    ? ", completed_at = unixepoch()"
    : ", completed_at = NULL";
  // When a run transitions out of 'running' (to any status), clear any pending
  // kill request so it can't linger and affect a subsequent run that somehow
  // reuses the id.
  const clearKill = status !== "running" ? ", kill_requested_at = NULL" : "";
  db.prepare(`UPDATE runs SET status = ?, updated_at = unixepoch()${completedAt}${clearKill} WHERE id = ?`).run(status, id);

  // Release any task claim when the run reaches a terminal state. The agent
  // moved the task as part of finishing (or marked the run failed without
  // moving it); either way the claim is no longer valid and the next agent
  // watching the task's current stage should be free to pick it up.
  if ((status === "done" || status === "failed" || status === "skipped" || status === "killed") && existing?.task_id) {
    releaseTaskForRun(id);
  }

  // Advance the job's next_run_at when a run completes.
  // 'killed' is terminal for this run but does NOT advance the job's schedule —
  // the user stopped it intentionally and may resume it via a comment.
  if (status === "done" || status === "failed" || status === "skipped") {
    const run = getRunById(id);
    if (run?.job_id) {
      // Deactivate one-off jobs; advance schedule for recurring ones (only for
      // schedule-triggered jobs — task-triggered jobs fire on the next poll).
      const job = db.prepare(`SELECT one_off, trigger_kind FROM jobs WHERE id = ?`).get(run.job_id) as any;
      if (job?.one_off) {
        db.prepare(`UPDATE jobs SET active = 0, next_run_at = NULL, updated_at = unixepoch() WHERE id = ?`).run(run.job_id);
      } else if (job?.trigger_kind !== "task_stage") {
        advanceJobSchedule(run.job_id);
      }
    }
  }

  return getRunById(id);
}

/**
 * Mark a run for kill. The runner picks this up on its next kill-check and
 * SIGTERMs the CLI child. Returns true if the kill was recorded, false if the
 * run isn't in a killable state (not running, already killed, etc).
 */
export function requestKillRun(id: string): boolean {
  const db = getDb();
  const run = getRunById(id);
  if (!run) return false;
  if (run.status !== "running") return false;
  if (run.kill_requested_at) return true; // already requested — idempotent
  db.prepare(`UPDATE runs SET kill_requested_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).run(id);
  return true;
}

export function updateRunSessionId(id: string, sessionId: string, cwd?: string) {
  const db = getDb();
  if (cwd) {
    db.prepare(`UPDATE runs SET session_id = ?, session_cwd = ?, updated_at = unixepoch() WHERE id = ?`).run(sessionId, cwd, id);
  } else {
    db.prepare(`UPDATE runs SET session_id = ?, updated_at = unixepoch() WHERE id = ?`).run(sessionId, id);
  }
}

export function isKillRequested(id: string): boolean {
  const db = getDb();
  const row = db.prepare(`SELECT kill_requested_at FROM runs WHERE id = ?`).get(id) as any;
  return !!row?.kill_requested_at;
}

export function deleteRun(id: string) {
  const db = getDb();
  db.prepare(`DELETE FROM runs WHERE id = ?`).run(id);
  deleteRunAttachmentsDir(id);
}

export function listRunsByJob(jobId: string, limit = 50) {
  const db = getDb();
  return db.prepare(`
    SELECT r.*, j.name as job_name, a.name as agent_name
    FROM runs r
    JOIN jobs j ON r.job_id = j.id
    LEFT JOIN agents a ON r.agent_id = a.id
    WHERE r.job_id = ? ORDER BY r.created_at DESC LIMIT ?
  `).all(jobId, limit);
}

export function listRunsByAgent(agentId: string, limit = 50) {
  const db = getDb();
  return db.prepare(`
    SELECT r.*, j.name as job_name, a.name as agent_name
    FROM runs r
    JOIN jobs j ON r.job_id = j.id
    LEFT JOIN agents a ON r.agent_id = a.id
    WHERE r.agent_id = ? ORDER BY r.created_at DESC LIMIT ?
  `).all(agentId, limit);
}

export function listScheduledRuns(projectId?: string) {
  const db = getDb();
  const projectFilter = projectId ? `AND r.job_id IN (SELECT job_id FROM project_jobs WHERE project_id = ?)` : "";
  return db.prepare(`
    SELECT r.*, j.name as job_name, j.active as job_active, j.workflow_command as job_workflow_command, j.workflow_only as job_workflow_only, a.name as agent_name
    FROM runs r
    JOIN jobs j ON r.job_id = j.id
    LEFT JOIN agents a ON r.agent_id = a.id
    WHERE r.status = 'scheduled' ${projectFilter}
    ORDER BY r.scheduled_for ASC
  `).all(...(projectId ? [projectId] : []));
}

export function listRunningRuns(projectId?: string) {
  const db = getDb();
  const projectFilter = projectId ? `AND r.job_id IN (SELECT job_id FROM project_jobs WHERE project_id = ?)` : "";
  return db.prepare(`
    SELECT r.*, j.name as job_name, j.active as job_active, j.workflow_command as job_workflow_command, j.workflow_only as job_workflow_only, a.name as agent_name
    FROM runs r
    JOIN jobs j ON r.job_id = j.id
    LEFT JOIN agents a ON r.agent_id = a.id
    WHERE r.status = 'running' ${projectFilter}
    ORDER BY r.updated_at DESC
  `).all(...(projectId ? [projectId] : []));
}

export function listWaitingRuns(projectId?: string) {
  const db = getDb();
  const projectFilter = projectId ? `AND r.job_id IN (SELECT job_id FROM project_jobs WHERE project_id = ?)` : "";
  return db.prepare(`
    SELECT r.*, j.name as job_name, j.active as job_active, j.workflow_command as job_workflow_command, j.workflow_only as job_workflow_only, a.name as agent_name
    FROM runs r
    JOIN jobs j ON r.job_id = j.id
    LEFT JOIN agents a ON r.agent_id = a.id
    WHERE r.status IN ('waiting', 'pending') ${projectFilter}
    ORDER BY r.updated_at ASC
  `).all(...(projectId ? [projectId] : []));
}

export function listRecentRuns(limit = 10, projectId?: string) {
  const db = getDb();
  const projectFilter = projectId ? `AND r.job_id IN (SELECT job_id FROM project_jobs WHERE project_id = ?)` : "";
  return db.prepare(`
    SELECT r.*, j.name as job_name, j.active as job_active, j.workflow_command as job_workflow_command, j.workflow_only as job_workflow_only, a.name as agent_name
    FROM runs r
    JOIN jobs j ON r.job_id = j.id
    LEFT JOIN agents a ON r.agent_id = a.id
    WHERE r.status IN ('done', 'failed') ${projectFilter}
    ORDER BY r.completed_at DESC LIMIT ?
  `).all(...(projectId ? [projectId, limit] : [limit]));
}

// Activity log

export function addRunActivity(runId: string, authorType: string, authorId: string | null, authorName: string, content: string) {
  const db = getDb();
  const id = uuid();
  db.prepare(`
    INSERT INTO run_activity (id, run_id, author_type, author_id, author_name, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, runId, authorType, authorId, authorName, content);
  db.prepare(`UPDATE runs SET updated_at = unixepoch() WHERE id = ?`).run(runId);
  return { id, run_id: runId, author_type: authorType, author_id: authorId, author_name: authorName, content, created_at: Math.floor(Date.now() / 1000) };
}

export function listRunActivity(runId: string) {
  const db = getDb();
  return db.prepare(`SELECT * FROM run_activity WHERE run_id = ? ORDER BY created_at ASC`).all(runId);
}

// Run output (streaming events from CLI agents)

export type RunOutputEvent = {
  id?: number;
  run_id: string;
  event_type: string;
  content: string | null;
  tool_name: string | null;
  created_at?: number;
};

export function addRunOutput(runId: string, events: Omit<RunOutputEvent, "run_id" | "id" | "created_at">[]) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO run_output (run_id, event_type, content, tool_name)
    VALUES (?, ?, ?, ?)
  `);
  const insertMany = db.transaction((evts: typeof events) => {
    for (const e of evts) {
      stmt.run(runId, e.event_type, e.content || null, e.tool_name || null);
    }
  });
  insertMany(events);
  db.prepare(`UPDATE runs SET updated_at = unixepoch() WHERE id = ?`).run(runId);
}

export function listRunOutput(runId: string, afterId = 0) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM run_output WHERE run_id = ? AND id > ? ORDER BY id ASC
  `).all(runId, afterId) as RunOutputEvent[];
}

// Fail runs that have exceeded their job's timeout
function failStaleRuns(agentId: string) {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const stale = db.prepare(`
    SELECT r.id, j.timeout_minutes FROM runs r
    JOIN jobs j ON r.job_id = j.id
    WHERE r.agent_id = ? AND r.status = 'running'
    AND r.updated_at + (j.timeout_minutes * 60) < ?
  `).all(agentId, now) as { id: string; timeout_minutes: number }[];

  for (const run of stale) {
    db.prepare(`UPDATE runs SET status = 'failed', completed_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).run(run.id);
    const actId = uuid();
    db.prepare(`
      INSERT INTO run_activity (id, run_id, author_type, author_name, content, created_at)
      VALUES (?, ?, 'system', 'System', ?, unixepoch())
    `).run(actId, run.id, `Run timed out after ${run.timeout_minutes} minutes without completion.`);

    // Deactivate one-off jobs
    const job = db.prepare(`SELECT one_off FROM jobs WHERE id = (SELECT job_id FROM runs WHERE id = ?)`).get(run.id) as any;
    if (job?.one_off) {
      db.prepare(`UPDATE jobs SET active = 0, next_run_at = NULL, updated_at = unixepoch() WHERE id = (SELECT job_id FROM runs WHERE id = ?)`).run(run.id);
    }
  }

  return stale.length;
}

// Agent polling: get next run

export function getAgentNextRun(agentId: string) {
  const db = getDb();

  // 0. Fail any stale running runs that exceeded their timeout
  failStaleRuns(agentId);

  // Wrap in a transaction so run assignment is atomic
  const assignRun = db.transaction(() => {
    // 1. Agent already has a running run? Return nothing (busy)
    const running = db.prepare(`
      SELECT id FROM runs WHERE agent_id = ? AND status = 'running' LIMIT 1
    `).get(agentId) as any;
    if (running) return null;

    // 2. Pending run? (human responded, ready for agent to resume)
    const pendingRun = db.prepare(`
      SELECT id FROM runs
      WHERE agent_id = ? AND status = 'pending'
      ORDER BY updated_at ASC LIMIT 1
    `).get(agentId) as any;

    if (pendingRun) {
      db.prepare(`UPDATE runs SET status = 'running', updated_at = unixepoch() WHERE id = ?`).run(pendingRun.id);
      return pendingRun.id as string;
    }

    const now = Math.floor(Date.now() / 1000);

    // 3. Scheduled run ready to start? (one-off runs created via dashboard)
    const scheduledRun = db.prepare(`
      SELECT id FROM runs
      WHERE agent_id = ? AND status = 'scheduled' AND scheduled_for <= ?
      ORDER BY scheduled_for ASC LIMIT 1
    `).get(agentId, now) as any;

    if (scheduledRun) {
      db.prepare(`UPDATE runs SET status = 'running', claimed_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).run(scheduledRun.id);
      db.prepare(`UPDATE jobs SET last_run_at = unixepoch(), updated_at = unixepoch() WHERE id = (SELECT job_id FROM runs WHERE id = ?)`).run(scheduledRun.id);
      return scheduledRun.id as string;
    }

    // 4. Any recurring job past its schedule time without an active run?
    const readyJob = db.prepare(`
      SELECT j.id, j.agent_id FROM jobs j
      WHERE j.agent_id = ? AND j.active = 1 AND j.one_off = 0
      AND j.trigger_kind = 'schedule'
      AND j.next_run_at IS NOT NULL AND j.next_run_at <= ?
      AND NOT EXISTS (
        SELECT 1 FROM runs WHERE job_id = j.id AND status IN ('scheduled', 'running', 'waiting', 'pending')
      )
      ORDER BY j.next_run_at ASC LIMIT 1
    `).get(agentId, now) as any;

    if (readyJob) {
      const run = createRun(readyJob.id, agentId);
      db.prepare(`UPDATE jobs SET last_run_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).run(readyJob.id);
      // Advance next_run_at immediately so the job doesn't re-fire on the next poll
      advanceJobSchedule(readyJob.id);
      return run!.id as string;
    }

    // 5. Any task-triggered job whose watched stage has an unclaimed task?
    const readyTaskJob = db.prepare(`
      SELECT j.id AS job_id, t.id AS task_id
      FROM jobs j
      JOIN tasks t ON t.stage_id = j.watched_stage_id
        AND t.claimed_by_run_id IS NULL
        AND t.archived_at IS NULL
      WHERE j.agent_id = ?
        AND j.active = 1
        AND j.one_off = 0
        AND j.trigger_kind = 'task_stage'
        AND j.watched_stage_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM runs WHERE job_id = j.id AND status IN ('scheduled','running','waiting','pending')
        )
      ORDER BY t.position ASC, t.created_at ASC
      LIMIT 1
    `).get(agentId) as any;

    if (readyTaskJob) {
      // Insert the run first, then atomically claim the task. If the claim
      // loses the CAS race (another agent grabbed the same task in a parallel
      // poll), we delete the run we just inserted and try again next poll.
      const newRunId = uuid();
      db.prepare(`
        INSERT INTO runs (id, job_id, agent_id, status, claimed_at, task_id)
        VALUES (?, ?, ?, 'running', unixepoch(), ?)
      `).run(newRunId, readyTaskJob.job_id, agentId, readyTaskJob.task_id);
      const won = claimTaskForRun(readyTaskJob.task_id, newRunId);
      if (!won) {
        db.prepare(`DELETE FROM runs WHERE id = ?`).run(newRunId);
        return null;
      }
      // Log a 'claimed' activity entry on the task so the agent can see who
      // picked it up.
      db.prepare(`
        INSERT INTO task_activity (id, task_id, run_id, kind, author_type, author_name, content)
        VALUES (?, ?, ?, 'claimed', 'system', 'System', ?)
      `).run(uuid(), readyTaskJob.task_id, newRunId, `Claimed by agent run`);
      db.prepare(`UPDATE jobs SET last_run_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).run(readyTaskJob.job_id);
      return newRunId;
    }

    return null;
  });

  const runId = assignRun();
  if (!runId) return null;
  return buildRunPayload(runId);
}

// Workflow polling: get next agentless workflow-only run
export function getNextWorkflowRun() {
  const db = getDb();

  // Fail stale agentless workflow runs
  const now = Math.floor(Date.now() / 1000);
  const stale = db.prepare(`
    SELECT r.id, j.timeout_minutes FROM runs r
    JOIN jobs j ON r.job_id = j.id
    WHERE r.agent_id IS NULL AND r.status = 'running'
    AND r.updated_at + (j.timeout_minutes * 60) < ?
  `).all(now) as { id: string; timeout_minutes: number }[];
  for (const run of stale) {
    db.prepare(`UPDATE runs SET status = 'failed', completed_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).run(run.id);
    db.prepare(`
      INSERT INTO run_activity (id, run_id, author_type, author_name, content, created_at)
      VALUES (?, ?, 'system', 'System', ?, unixepoch())
    `).run(uuid(), run.id, `Run timed out after ${run.timeout_minutes} minutes without completion.`);
  }

  const assignRun = db.transaction(() => {
    // Scheduled run ready to start?
    const scheduledRun = db.prepare(`
      SELECT id FROM runs
      WHERE agent_id IS NULL AND status = 'scheduled' AND scheduled_for <= ?
      ORDER BY scheduled_for ASC LIMIT 1
    `).get(now) as any;

    if (scheduledRun) {
      db.prepare(`UPDATE runs SET status = 'running', claimed_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).run(scheduledRun.id);
      db.prepare(`UPDATE jobs SET last_run_at = unixepoch(), updated_at = unixepoch() WHERE id = (SELECT job_id FROM runs WHERE id = ?)`).run(scheduledRun.id);
      return scheduledRun.id as string;
    }

    // Any recurring agentless workflow job past its schedule time?
    const readyJob = db.prepare(`
      SELECT j.id FROM jobs j
      WHERE j.agent_id IS NULL AND j.active = 1 AND j.one_off = 0
      AND j.workflow_only = 1 AND j.workflow_command IS NOT NULL
      AND j.trigger_kind = 'schedule'
      AND j.next_run_at IS NOT NULL AND j.next_run_at <= ?
      AND NOT EXISTS (
        SELECT 1 FROM runs WHERE job_id = j.id AND status IN ('scheduled', 'running', 'waiting', 'pending')
      )
      ORDER BY j.next_run_at ASC LIMIT 1
    `).get(now) as any;

    if (readyJob) {
      const run = createRun(readyJob.id, null);
      db.prepare(`UPDATE jobs SET last_run_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).run(readyJob.id);
      advanceJobSchedule(readyJob.id);
      return run!.id as string;
    }

    // Task-triggered agentless workflow jobs
    const readyTaskJob = db.prepare(`
      SELECT j.id AS job_id, t.id AS task_id
      FROM jobs j
      JOIN tasks t ON t.stage_id = j.watched_stage_id
        AND t.claimed_by_run_id IS NULL
        AND t.archived_at IS NULL
      WHERE j.agent_id IS NULL
        AND j.active = 1
        AND j.one_off = 0
        AND j.workflow_only = 1
        AND j.workflow_command IS NOT NULL
        AND j.trigger_kind = 'task_stage'
        AND j.watched_stage_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM runs WHERE job_id = j.id AND status IN ('scheduled','running','waiting','pending')
        )
      ORDER BY t.position ASC, t.created_at ASC
      LIMIT 1
    `).get() as any;

    if (readyTaskJob) {
      const newRunId = uuid();
      db.prepare(`
        INSERT INTO runs (id, job_id, agent_id, status, claimed_at, task_id)
        VALUES (?, ?, NULL, 'running', unixepoch(), ?)
      `).run(newRunId, readyTaskJob.job_id, readyTaskJob.task_id);
      const won = claimTaskForRun(readyTaskJob.task_id, newRunId);
      if (!won) {
        db.prepare(`DELETE FROM runs WHERE id = ?`).run(newRunId);
        return null;
      }
      db.prepare(`
        INSERT INTO task_activity (id, task_id, run_id, kind, author_type, author_name, content)
        VALUES (?, ?, ?, 'claimed', 'system', 'System', ?)
      `).run(uuid(), readyTaskJob.task_id, newRunId, `Claimed by workflow run`);
      db.prepare(`UPDATE jobs SET last_run_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).run(readyTaskJob.job_id);
      return newRunId;
    }

    return null;
  });

  const runId = assignRun();
  if (!runId) return null;
  return buildRunPayload(runId);
}

export function peekAgentNext(agentId: string) {
  const db = getDb();

  // Fail stale runs so peek accurately reflects availability
  failStaleRuns(agentId);

  const running = db.prepare(`
    SELECT id FROM runs WHERE agent_id = ? AND status = 'running' LIMIT 1
  `).get(agentId) as any;
  if (running) return { available: false, reason: "busy" };

  const pendingRun = db.prepare(`
    SELECT r.id, j.name as job_name FROM runs r
    JOIN jobs j ON r.job_id = j.id
    WHERE r.agent_id = ? AND r.status = 'pending'
    ORDER BY r.updated_at ASC LIMIT 1
  `).get(agentId) as any;

  if (pendingRun) {
    return { available: true, type: "pending_resume", run_id: pendingRun.id, job_name: pendingRun.job_name };
  }

  const now = Math.floor(Date.now() / 1000);

  const scheduledRun = db.prepare(`
    SELECT r.id, j.name as job_name FROM runs r
    JOIN jobs j ON r.job_id = j.id
    WHERE r.agent_id = ? AND r.status = 'scheduled' AND r.scheduled_for <= ?
    ORDER BY r.scheduled_for ASC LIMIT 1
  `).get(agentId, now) as any;

  if (scheduledRun) {
    return { available: true, type: "scheduled_run", run_id: scheduledRun.id, job_name: scheduledRun.job_name };
  }

  const readyJob = db.prepare(`
    SELECT j.id, j.name FROM jobs j
    WHERE j.agent_id = ? AND j.active = 1 AND j.one_off = 0
    AND j.next_run_at IS NOT NULL AND j.next_run_at <= ?
    AND NOT EXISTS (SELECT 1 FROM runs WHERE job_id = j.id AND status IN ('scheduled', 'running', 'waiting', 'pending'))
    ORDER BY j.next_run_at ASC LIMIT 1
  `).get(agentId, now) as any;

  if (readyJob) {
    return { available: true, type: "scheduled", job_id: readyJob.id, job_name: readyJob.name };
  }

  return { available: false, reason: "nothing_to_do" };
}

function buildRunPayload(runId: string) {
  const db = getDb();
  const run = getRunWithActivity(runId);
  if (!run) return null;

  const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(run.job_id) as any;

  // Get referenced docs
  const docs = db.prepare(`
    SELECT d.id, d.title, dr.content
    FROM job_docs jd
    JOIN docs d ON jd.doc_id = d.id
    LEFT JOIN doc_revisions dr ON dr.doc_id = d.id
    AND dr.created_at = (SELECT MAX(created_at) FROM doc_revisions WHERE doc_id = d.id)
    WHERE jd.job_id = ?
  `).all(run.job_id);

  // Get referenced databases (recent rows from each linked table)
  const linkedDbs = db.prepare(`
    SELECT d.name, d.table_name
    FROM job_databases jd
    JOIN databases d ON jd.database_id = d.id
    WHERE jd.job_id = ?
  `).all(run.job_id) as { name: string; table_name: string }[];

  const data: Record<string, any> = {};
  for (const d of linkedDbs) {
    data[d.name] = db.prepare(
      `SELECT * FROM "${d.table_name}" ORDER BY rowid DESC LIMIT 100`
    ).all();
  }

  // Decrypt env vars for this job
  const env = getDecryptedEnvVarsForJob(run.job_id);

  // Run attachments (raw rows; the route serializer adds absolute URLs)
  const attachments = listAttachmentsByRun(run.id);

  // Combine job instructions with any extra trigger-time instructions
  let instructions = job.instructions || null;
  if (run.extra_instructions) {
    instructions = instructions
      ? `${instructions}\n\n---\n\nAdditional instructions for this run:\n${run.extra_instructions}`
      : run.extra_instructions;
  }

  // Task bundle: when this run is bound to a task, include the task content,
  // current stage, legal next stages, and prior activity (especially reviewer
  // feedback on a kicked-back card).
  let task: any = null;
  if (run.task_id) {
    const taskRow = db.prepare(`
      SELECT t.*, s.name AS stage_name, s.is_terminal AS stage_is_terminal, p.name AS project_name
      FROM tasks t
      JOIN project_stages s ON t.stage_id = s.id
      JOIN projects p ON t.project_id = p.id
      WHERE t.id = ?
    `).get(run.task_id) as any;
    if (taskRow) {
      const legalIds = getLegalTransitions(taskRow.stage_id);
      const stages = legalIds.length > 0
        ? db.prepare(
            `SELECT id, name, is_terminal FROM project_stages WHERE id IN (${legalIds.map(() => "?").join(",")})`
          ).all(...legalIds) as any[]
        : [];
      const activityRows = listTaskActivity(run.task_id);
      // Resolve stage names for activity entries that reference stage transitions
      const stageNameMap: Record<string, string> = {};
      const allStages = db.prepare(
        `SELECT id, name FROM project_stages WHERE project_id = ?`
      ).all(taskRow.project_id) as { id: string; name: string }[];
      for (const s of allStages) stageNameMap[s.id] = s.name;
      task = {
        id: taskRow.id,
        title: taskRow.title,
        description: taskRow.description,
        project_id: taskRow.project_id,
        project_name: taskRow.project_name,
        stage: {
          id: taskRow.stage_id,
          name: taskRow.stage_name,
          is_terminal: !!taskRow.stage_is_terminal,
        },
        legal_transitions: stages.map(s => ({
          id: s.id,
          name: s.name,
          is_terminal: !!s.is_terminal,
        })),
        activity: activityRows.map(a => ({
          ...a,
          from_stage_name: a.from_stage_id ? (stageNameMap[a.from_stage_id] ?? null) : null,
          to_stage_name: a.to_stage_id ? (stageNameMap[a.to_stage_id] ?? null) : null,
        })),
      };
    }
  }

  return {
    run: { id: run.id, status: run.status, activity: run.activity, task_id: run.task_id || null },
    job: {
      id: job.id,
      name: job.name,
      instructions,
      workflow: job.workflow_command,
      workflow_only: !!job.workflow_only,
      model: job.model || null,
      thinking: job.thinking || null,
      timeout_minutes: job.timeout_minutes ?? 30,
      trigger_kind: job.trigger_kind || "schedule",
    },
    task,
    docs,
    data,
    env,
    attachments,
  };
}

