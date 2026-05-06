import { getDb } from "./schema";
import { v4 as uuid } from "uuid";

export type Stage = {
  id: string;
  board_id: string;
  name: string;
  position: number;
  is_terminal: number;
  created_at: number;
  updated_at: number;
};

export type StageWithTransitions = Stage & { transitions_to: string[] };

export function listStagesForBoard(boardId: string): StageWithTransitions[] {
  const db = getDb();
  const stages = db.prepare(
    `SELECT * FROM stages WHERE board_id = ? ORDER BY position ASC`
  ).all(boardId) as Stage[];
  if (stages.length === 0) return [];
  const stageIds = stages.map(s => s.id);
  const placeholders = stageIds.map(() => "?").join(",");
  const transitions = db.prepare(
    `SELECT from_stage_id, to_stage_id FROM stage_transitions WHERE from_stage_id IN (${placeholders})`
  ).all(...stageIds) as { from_stage_id: string; to_stage_id: string }[];
  const tMap: Record<string, string[]> = {};
  for (const s of stages) tMap[s.id] = [];
  for (const t of transitions) tMap[t.from_stage_id].push(t.to_stage_id);
  return stages.map(s => ({ ...s, transitions_to: tMap[s.id] }));
}

export function getStageById(id: string): Stage | null {
  const db = getDb();
  return (db.prepare(`SELECT * FROM stages WHERE id = ?`).get(id) as Stage) || null;
}

export function getLegalTransitions(stageId: string): string[] {
  const db = getDb();
  return (db.prepare(
    `SELECT to_stage_id FROM stage_transitions WHERE from_stage_id = ?`
  ).all(stageId) as { to_stage_id: string }[]).map(r => r.to_stage_id);
}

export function isTransitionLegal(fromStageId: string, toStageId: string): boolean {
  const db = getDb();
  const row = db.prepare(
    `SELECT 1 FROM stage_transitions WHERE from_stage_id = ? AND to_stage_id = ?`
  ).get(fromStageId, toStageId);
  return !!row;
}

export function createStage(boardId: string, data: {
  name: string;
  position?: number;
  is_terminal?: boolean;
}): Stage {
  const db = getDb();
  const id = uuid();
  let position = data.position;
  if (position === undefined) {
    const max = db.prepare(
      `SELECT COALESCE(MAX(position), -1) AS max FROM stages WHERE board_id = ?`
    ).get(boardId) as { max: number };
    position = max.max + 1;
  }
  db.prepare(
    `INSERT INTO stages (id, board_id, name, position, is_terminal) VALUES (?, ?, ?, ?, ?)`
  ).run(id, boardId, data.name, position, data.is_terminal ? 1 : 0);
  return getStageById(id)!;
}

export function updateStage(id: string, data: {
  name?: string;
  position?: number;
  is_terminal?: boolean;
}): Stage | null {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];
  if (data.name !== undefined) { fields.push("name = ?"); values.push(data.name); }
  if (data.position !== undefined) { fields.push("position = ?"); values.push(data.position); }
  if (data.is_terminal !== undefined) { fields.push("is_terminal = ?"); values.push(data.is_terminal ? 1 : 0); }
  if (fields.length === 0) return getStageById(id);
  fields.push("updated_at = unixepoch()");
  values.push(id);
  db.prepare(`UPDATE stages SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getStageById(id);
}

export function deleteStage(id: string): { ok: boolean; reason?: string } {
  const db = getDb();
  const stage = getStageById(id);
  if (!stage) return { ok: false, reason: "stage not found" };

  const taskCount = db.prepare(
    `SELECT COUNT(*) AS n FROM tasks WHERE stage_id = ? AND archived_at IS NULL`
  ).get(id) as { n: number };
  if (taskCount.n > 0) {
    return { ok: false, reason: `Stage has ${taskCount.n} active task(s). Move or archive them before deleting.` };
  }

  const watchingJobs = db.prepare(
    `SELECT COUNT(*) AS n FROM jobs WHERE watched_stage_id = ?`
  ).get(id) as { n: number };
  if (watchingJobs.n > 0) {
    return { ok: false, reason: `${watchingJobs.n} job(s) watch this stage. Reconfigure them before deleting.` };
  }

  db.prepare(`DELETE FROM stages WHERE id = ?`).run(id);
  return { ok: true };
}

/** Reorder all stages on a board to match the given id list. */
export function reorderStages(boardId: string, stageIds: string[]) {
  const db = getDb();
  const existing = db.prepare(`SELECT id FROM stages WHERE board_id = ?`).all(boardId) as { id: string }[];
  const existingSet = new Set(existing.map(e => e.id));
  if (stageIds.length !== existing.length || !stageIds.every(id => existingSet.has(id))) {
    throw new Error("reorderStages must include exactly the stages belonging to the board");
  }
  const stmt = db.prepare(`UPDATE stages SET position = ?, updated_at = unixepoch() WHERE id = ?`);
  db.transaction(() => {
    for (let i = 0; i < stageIds.length; i++) stmt.run(i, stageIds[i]);
  })();
}

/** Replace the outgoing transitions for a stage with the given list. */
export function setStageTransitions(stageId: string, toStageIds: string[]) {
  const db = getDb();
  const stage = getStageById(stageId);
  if (!stage) throw new Error("stage not found");
  const validTargets = db.prepare(
    `SELECT id FROM stages WHERE board_id = ?`
  ).all(stage.board_id) as { id: string }[];
  const validSet = new Set(validTargets.map(t => t.id));
  for (const t of toStageIds) {
    if (!validSet.has(t)) throw new Error(`target stage ${t} is not on the same board`);
    if (t === stageId) throw new Error("a stage cannot transition to itself");
  }
  db.transaction(() => {
    db.prepare(`DELETE FROM stage_transitions WHERE from_stage_id = ?`).run(stageId);
    const insert = db.prepare(`INSERT INTO stage_transitions (from_stage_id, to_stage_id) VALUES (?, ?)`);
    for (const t of toStageIds) insert.run(stageId, t);
  })();
}

/** Number of jobs watching this stage as their trigger. */
export function countJobsWatching(stageId: string): number {
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE watched_stage_id = ?`).get(stageId) as { n: number };
  return row.n;
}
