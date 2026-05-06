import { getDb, createBoardWithDefaults } from "./schema";

export type Board = {
  id: string;
  name: string;
  project_id: string | null;
  created_at: number;
  updated_at: number;
};

export type BoardWithStats = Board & {
  project_name: string | null;
  stage_count: number;
  task_count: number;
};

/**
 * List all boards, with project name (when linked) and stage/task counts.
 * Used by the boards index in All Projects mode.
 */
export function listBoards(): BoardWithStats[] {
  const db = getDb();
  return db.prepare(`
    SELECT b.*,
      p.name AS project_name,
      (SELECT COUNT(*) FROM stages WHERE board_id = b.id) AS stage_count,
      (SELECT COUNT(*) FROM tasks WHERE board_id = b.id AND archived_at IS NULL) AS task_count
    FROM boards b
    LEFT JOIN projects p ON b.project_id = p.id
    ORDER BY (b.project_id IS NULL) DESC, b.name ASC
  `).all() as BoardWithStats[];
}

export function getBoardById(id: string): Board | null {
  const db = getDb();
  return (db.prepare(`SELECT * FROM boards WHERE id = ?`).get(id) as Board) || null;
}

/** The default top-level board (no project). Always exists post-migration. */
export function getTopLevelBoard(): Board | null {
  const db = getDb();
  return (db.prepare(
    `SELECT * FROM boards WHERE project_id IS NULL ORDER BY created_at ASC LIMIT 1`
  ).get() as Board) || null;
}

export function getBoardForProject(projectId: string): Board | null {
  const db = getDb();
  return (db.prepare(
    `SELECT * FROM boards WHERE project_id = ? ORDER BY created_at ASC LIMIT 1`
  ).get(projectId) as Board) || null;
}

/**
 * Create a new board (top-level if projectId is null, otherwise linked to that
 * project). Seeds default stages so the board is immediately usable.
 */
export function createBoard(opts: { name: string; projectId?: string | null }): Board {
  const db = getDb();
  const id = createBoardWithDefaults(db, { name: opts.name, projectId: opts.projectId ?? null });
  return getBoardById(id)!;
}

export function updateBoard(id: string, data: { name?: string }): Board | null {
  const db = getDb();
  if (data.name !== undefined) {
    db.prepare(`UPDATE boards SET name = ?, updated_at = unixepoch() WHERE id = ?`).run(data.name, id);
  }
  return getBoardById(id);
}

export function deleteBoard(id: string) {
  const db = getDb();
  db.prepare(`DELETE FROM boards WHERE id = ?`).run(id);
}

/**
 * Resolve the active board for the current view. If a project is active and
 * has a board, return it. Otherwise return the top-level board. Used by /board
 * page logic when navigating in All Projects mode.
 */
export function resolveActiveBoard(activeProjectId: string | null): Board | null {
  if (activeProjectId) {
    return getBoardForProject(activeProjectId);
  }
  return getTopLevelBoard();
}
