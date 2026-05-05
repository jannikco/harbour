import { getDb } from "./schema";
import { v4 as uuid } from "uuid";
import { isTransitionLegal, getStageById } from "./stages";

export type Task = {
  id: string;
  project_id: string;
  stage_id: string;
  title: string;
  description: string | null;
  position: number;
  claimed_by_run_id: string | null;
  archived_at: number | null;
  created_by_type: "user" | "agent" | null;
  created_by_id: string | null;
  created_at: number;
  updated_at: number;
};

export type TaskActivity = {
  id: string;
  task_id: string;
  run_id: string | null;
  kind: "comment" | "stage_change" | "created" | "claimed" | "released";
  from_stage_id: string | null;
  to_stage_id: string | null;
  author_type: "user" | "agent" | "system";
  author_id: string | null;
  author_name: string | null;
  content: string | null;
  created_at: number;
};

function topPosition(stageId: string): number {
  const db = getDb();
  const row = db.prepare(
    `SELECT COALESCE(MIN(position), 0) AS min FROM tasks WHERE stage_id = ? AND archived_at IS NULL`
  ).get(stageId) as { min: number };
  return row.min - 1;
}

function bottomPosition(stageId: string): number {
  const db = getDb();
  const row = db.prepare(
    `SELECT COALESCE(MAX(position), -1) AS max FROM tasks WHERE stage_id = ? AND archived_at IS NULL`
  ).get(stageId) as { max: number };
  return row.max + 1;
}

export function createTask(data: {
  projectId: string;
  stageId: string;
  title: string;
  description?: string | null;
  insertAt?: "top" | "bottom";
  authorType?: "user" | "agent";
  authorId?: string | null;
  authorName?: string | null;
}): Task {
  const db = getDb();
  const stage = getStageById(data.stageId);
  if (!stage) throw new Error("stage not found");
  if (stage.project_id !== data.projectId) throw new Error("stage does not belong to project");

  const id = uuid();
  const insertAt = data.insertAt ?? "bottom";
  const position = insertAt === "top" ? topPosition(data.stageId) : bottomPosition(data.stageId);

  db.transaction(() => {
    db.prepare(
      `INSERT INTO tasks (id, project_id, stage_id, title, description, position, created_by_type, created_by_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      data.projectId,
      data.stageId,
      data.title,
      data.description ?? null,
      position,
      data.authorType ?? null,
      data.authorId ?? null
    );
    db.prepare(
      `INSERT INTO task_activity (id, task_id, kind, to_stage_id, author_type, author_id, author_name, content)
       VALUES (?, ?, 'created', ?, ?, ?, ?, ?)`
    ).run(
      uuid(),
      id,
      data.stageId,
      data.authorType ?? "system",
      data.authorId ?? null,
      data.authorName ?? null,
      `Created in ${stage.name}`
    );
  })();

  return getTaskById(id)!;
}

export function getTaskById(id: string): Task | null {
  const db = getDb();
  return (db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as Task) || null;
}

export function getTaskWithStage(id: string): (Task & { stage_name: string; project_name: string }) | null {
  const db = getDb();
  return (db.prepare(`
    SELECT t.*, s.name AS stage_name, p.name AS project_name
    FROM tasks t
    JOIN project_stages s ON t.stage_id = s.id
    JOIN projects p ON t.project_id = p.id
    WHERE t.id = ?
  `).get(id) as any) || null;
}

export function listTasksByProject(projectId: string, opts: { includeArchived?: boolean } = {}) {
  const db = getDb();
  const where = opts.includeArchived ? `t.project_id = ?` : `t.project_id = ? AND t.archived_at IS NULL`;
  return db.prepare(`
    SELECT t.*, s.name AS stage_name,
      a.id AS claimed_run_agent_id,
      a.name AS claimed_run_agent_name
    FROM tasks t
    JOIN project_stages s ON t.stage_id = s.id
    LEFT JOIN runs r ON t.claimed_by_run_id = r.id
    LEFT JOIN agents a ON r.agent_id = a.id
    WHERE ${where}
    ORDER BY s.position ASC, t.position ASC
  `).all(projectId);
}

export function listTasksByStage(stageId: string) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM tasks
    WHERE stage_id = ? AND archived_at IS NULL
    ORDER BY position ASC
  `).all(stageId) as Task[];
}

export function updateTask(id: string, data: { title?: string; description?: string | null }): Task | null {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];
  if (data.title !== undefined) { fields.push("title = ?"); values.push(data.title); }
  if (data.description !== undefined) { fields.push("description = ?"); values.push(data.description); }
  if (fields.length === 0) return getTaskById(id);
  fields.push("updated_at = unixepoch()");
  values.push(id);
  db.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getTaskById(id);
}

export function deleteTask(id: string) {
  const db = getDb();
  db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
}

export function archiveTask(id: string) {
  const db = getDb();
  db.prepare(`UPDATE tasks SET archived_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).run(id);
}

/** Reposition a task within its stage; bumps position to top by default. */
export function reorderTaskToTop(taskId: string) {
  const db = getDb();
  const task = getTaskById(taskId);
  if (!task) return;
  const newPos = topPosition(task.stage_id);
  db.prepare(`UPDATE tasks SET position = ?, updated_at = unixepoch() WHERE id = ?`).run(newPos, taskId);
}

export function addTaskActivity(data: {
  taskId: string;
  kind: TaskActivity["kind"];
  authorType: TaskActivity["author_type"];
  authorId?: string | null;
  authorName?: string | null;
  content?: string | null;
  fromStageId?: string | null;
  toStageId?: string | null;
  runId?: string | null;
}): TaskActivity {
  const db = getDb();
  const id = uuid();
  db.prepare(`
    INSERT INTO task_activity (id, task_id, run_id, kind, from_stage_id, to_stage_id, author_type, author_id, author_name, content)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.taskId,
    data.runId ?? null,
    data.kind,
    data.fromStageId ?? null,
    data.toStageId ?? null,
    data.authorType,
    data.authorId ?? null,
    data.authorName ?? null,
    data.content ?? null
  );
  db.prepare(`UPDATE tasks SET updated_at = unixepoch() WHERE id = ?`).run(data.taskId);
  return db.prepare(`SELECT * FROM task_activity WHERE id = ?`).get(id) as TaskActivity;
}

export function listTaskActivity(taskId: string) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM task_activity
    WHERE task_id = ?
    ORDER BY created_at ASC, rowid ASC
  `).all(taskId) as TaskActivity[];
}

/**
 * Atomically claim a task for a run. Returns true if this caller won the race.
 * Used by the runs poller (step 4.5).
 */
export function claimTaskForRun(taskId: string, runId: string): boolean {
  const db = getDb();
  const result = db.prepare(
    `UPDATE tasks SET claimed_by_run_id = ?, updated_at = unixepoch()
     WHERE id = ? AND claimed_by_run_id IS NULL`
  ).run(runId, taskId);
  return result.changes > 0;
}

export function releaseTask(taskId: string) {
  const db = getDb();
  db.prepare(
    `UPDATE tasks SET claimed_by_run_id = NULL, updated_at = unixepoch() WHERE id = ?`
  ).run(taskId);
}

/** Release the task claimed by this run (no-op if none). */
export function releaseTaskForRun(runId: string) {
  const db = getDb();
  db.prepare(
    `UPDATE tasks SET claimed_by_run_id = NULL, updated_at = unixepoch() WHERE claimed_by_run_id = ?`
  ).run(runId);
}

/** Move a task to a new stage, validating the transition is legal. */
export function moveTaskToStage(taskId: string, toStageId: string, actor: {
  authorType: "user" | "agent" | "system";
  authorId?: string | null;
  authorName?: string | null;
  content?: string | null;
  runId?: string | null;
}): { ok: true; task: Task } | { ok: false; reason: string } {
  const db = getDb();
  const task = getTaskById(taskId);
  if (!task) return { ok: false, reason: "task not found" };
  if (task.stage_id === toStageId) return { ok: false, reason: "task is already in that stage" };

  const target = getStageById(toStageId);
  if (!target) return { ok: false, reason: "target stage not found" };
  if (target.project_id !== task.project_id) return { ok: false, reason: "target stage is in a different project" };

  if (!isTransitionLegal(task.stage_id, toStageId)) {
    return { ok: false, reason: "transition is not allowed by the project board" };
  }

  const fromStageId = task.stage_id;
  const newPosition = bottomPosition(toStageId);

  db.transaction(() => {
    // Don't clear the claim here — the run that owns the task may move it
    // through several stages before finishing. The claim is released when the
    // run reaches a terminal status (see updateRunStatus).
    db.prepare(
      `UPDATE tasks SET stage_id = ?, position = ?, updated_at = unixepoch() WHERE id = ?`
    ).run(toStageId, newPosition, taskId);
    db.prepare(`
      INSERT INTO task_activity (id, task_id, run_id, kind, from_stage_id, to_stage_id, author_type, author_id, author_name, content)
      VALUES (?, ?, ?, 'stage_change', ?, ?, ?, ?, ?, ?)
    `).run(
      uuid(),
      taskId,
      actor.runId ?? null,
      fromStageId,
      toStageId,
      actor.authorType,
      actor.authorId ?? null,
      actor.authorName ?? null,
      actor.content ?? null
    );
  })();

  return { ok: true, task: getTaskById(taskId)! };
}

/** Does this agent currently own the active claim on this task? */
export function hasActiveTaskClaim(agentId: string, taskId: string): boolean {
  const db = getDb();
  const row = db.prepare(`
    SELECT 1 FROM tasks t
    JOIN runs r ON t.claimed_by_run_id = r.id
    WHERE t.id = ? AND r.agent_id = ? AND r.status = 'running'
  `).get(taskId, agentId);
  return !!row;
}

/** Whether the task currently sits in the watched stage of the run's job. */
export function isTaskMovedFromWatchedStage(runId: string): boolean {
  const db = getDb();
  const row = db.prepare(`
    SELECT t.stage_id AS task_stage, j.watched_stage_id AS job_stage
    FROM runs r
    JOIN jobs j ON r.job_id = j.id
    LEFT JOIN tasks t ON r.task_id = t.id
    WHERE r.id = ?
  `).get(runId) as { task_stage: string | null; job_stage: string | null } | undefined;
  if (!row || !row.task_stage || !row.job_stage) return true;
  return row.task_stage !== row.job_stage;
}
