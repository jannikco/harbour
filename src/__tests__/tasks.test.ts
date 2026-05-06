import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { setDb, resetDb, initializeSchema, getDb } from "@/lib/db/schema";
import {
  createProject,
  getProjectById,
  listBoards,
  getBoardById,
  getBoardForProject,
  getTopLevelBoard,
  createBoard,
  resolveActiveBoard,
  listStagesForBoard,
  getStageById,
  isTransitionLegal,
  createStage,
  updateStage,
  deleteStage,
  setStageTransitions,
  reorderStages,
  countJobsWatching,
  createTask,
  getTaskById,
  listTasksByBoard,
  listTasksByStage,
  moveTaskToStage,
  archiveTask,
  addTaskActivity,
  listTaskActivity,
  claimTaskForRun,
  releaseTask,
  hasActiveTaskClaim,
  isTaskMovedFromWatchedStage,
  createAgent,
  createJob,
  getAgentNextRun,
  updateRunStatus,
  validateRunStatusTransition,
  getRunById,
} from "@/lib/db/queries";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

beforeEach(() => {
  const db = freshDb();
  setDb(db);
  initializeSchema(db);
});

afterEach(() => {
  resetDb();
});

describe("Default top-level board", () => {
  it("a top-level board exists after init even without any project", () => {
    const top = getTopLevelBoard();
    expect(top).not.toBeNull();
    expect(top!.project_id).toBeNull();
    const stages = listStagesForBoard(top!.id);
    expect(stages.map(s => s.name)).toEqual(["To Do", "Doing", "Review", "Done"]);
  });

  it("listBoards returns top-level board first, then project-linked ones", () => {
    const project = createProject("Demo")!;
    const boards = listBoards();
    expect(boards.length).toBe(2);
    expect(boards[0].project_id).toBeNull();
    expect(boards[1].project_id).toBe(project.id);
  });
});

describe("Project board auto-creation", () => {
  it("creates a board with default stages when a project is created", () => {
    const project = createProject("Demo")!;
    const board = getBoardForProject(project.id);
    expect(board).not.toBeNull();
    const stages = listStagesForBoard(board!.id);
    expect(stages.map(s => s.name)).toEqual(["To Do", "Doing", "Review", "Done"]);
    const done = stages.find(s => s.name === "Done")!;
    expect(done.is_terminal).toBe(1);
  });

  it("default transitions are wired up correctly", () => {
    const project = createProject("Demo")!;
    const board = getBoardForProject(project.id)!;
    const stages = listStagesForBoard(board.id);
    const todo = stages.find(s => s.name === "To Do")!;
    const doing = stages.find(s => s.name === "Doing")!;
    const review = stages.find(s => s.name === "Review")!;
    const done = stages.find(s => s.name === "Done")!;

    expect(isTransitionLegal(todo.id, doing.id)).toBe(true);
    expect(isTransitionLegal(doing.id, review.id)).toBe(true);
    expect(isTransitionLegal(review.id, done.id)).toBe(true);
    expect(isTransitionLegal(review.id, todo.id)).toBe(true);
    expect(isTransitionLegal(doing.id, todo.id)).toBe(true);
    expect(isTransitionLegal(todo.id, review.id)).toBe(false);
  });
});

describe("resolveActiveBoard", () => {
  it("returns the project's board when one is active", () => {
    const project = createProject("Demo")!;
    const board = resolveActiveBoard(project.id);
    expect(board).not.toBeNull();
    expect(board!.project_id).toBe(project.id);
  });

  it("returns the top-level board when no project is active", () => {
    createProject("Demo");
    const board = resolveActiveBoard(null);
    expect(board).not.toBeNull();
    expect(board!.project_id).toBeNull();
  });
});

describe("Task lifecycle", () => {
  function setup() {
    const project = createProject("Demo")!;
    const board = getBoardForProject(project.id)!;
    const stages = listStagesForBoard(board.id);
    return {
      project,
      board,
      todo: stages.find(s => s.name === "To Do")!,
      doing: stages.find(s => s.name === "Doing")!,
      review: stages.find(s => s.name === "Review")!,
      done: stages.find(s => s.name === "Done")!,
    };
  }

  it("creates a task with a 'created' activity entry", () => {
    const { board, todo } = setup();
    const task = createTask({
      boardId: board.id,
      stageId: todo.id,
      title: "Write blog post",
      description: "About the new feature",
    });
    expect(task.title).toBe("Write blog post");
    expect(task.stage_id).toBe(todo.id);
    expect(task.archived_at).toBeNull();

    const activity = listTaskActivity(task.id);
    expect(activity).toHaveLength(1);
    expect(activity[0].kind).toBe("created");
  });

  it("moveTaskToStage rejects illegal transitions", () => {
    const { board, todo, review } = setup();
    const task = createTask({ boardId: board.id, stageId: todo.id, title: "Card" });
    const result = moveTaskToStage(task.id, review.id, { authorType: "user", authorName: "Tester" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not allowed/);
  });

  it("moveTaskToStage allows legal transitions and logs them", () => {
    const { board, todo, doing } = setup();
    const task = createTask({ boardId: board.id, stageId: todo.id, title: "Card" });
    const result = moveTaskToStage(task.id, doing.id, { authorType: "user", authorName: "Tester" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.task.stage_id).toBe(doing.id);

    const activity = listTaskActivity(task.id);
    expect(activity.map(a => a.kind)).toEqual(["created", "stage_change"]);
    expect(activity[1].from_stage_id).toBe(todo.id);
    expect(activity[1].to_stage_id).toBe(doing.id);
  });

  it("listTasksByStage returns tasks ordered by position", () => {
    const { board, todo } = setup();
    createTask({ boardId: board.id, stageId: todo.id, title: "First" });
    createTask({ boardId: board.id, stageId: todo.id, title: "Second" });
    createTask({ boardId: board.id, stageId: todo.id, title: "Third (top)", insertAt: "top" });
    const list = listTasksByStage(todo.id);
    expect(list.map(t => t.title)).toEqual(["Third (top)", "First", "Second"]);
  });

  it("archiveTask removes a task from the active list", () => {
    const { board, todo } = setup();
    const task = createTask({ boardId: board.id, stageId: todo.id, title: "Card" });
    archiveTask(task.id);
    expect(listTasksByStage(todo.id)).toHaveLength(0);
  });
});

describe("Claim atomicity (CAS race)", () => {
  it("only one of two competing claims wins", () => {
    const project = createProject("Demo")!;
    const board = getBoardForProject(project.id)!;
    const stages = listStagesForBoard(board.id);
    const todo = stages.find(s => s.name === "To Do")!;
    const task = createTask({ boardId: board.id, stageId: todo.id, title: "Card" });

    const agent = createAgent("worker", "");
    const job = createJob(agent.id, { name: "J", schedule: "{}", triggerKind: "task_stage", watchedStageId: todo.id });
    const db = getDb();
    const insertRun = db.prepare(`INSERT INTO runs (id, job_id, agent_id, status) VALUES (?, ?, ?, 'running')`);
    insertRun.run("run-1", job!.id, agent.id);
    insertRun.run("run-2", job!.id, agent.id);
    insertRun.run("run-3", job!.id, agent.id);

    const won1 = claimTaskForRun(task.id, "run-1");
    const won2 = claimTaskForRun(task.id, "run-2");
    expect(won1).toBe(true);
    expect(won2).toBe(false);

    releaseTask(task.id);
    const won3 = claimTaskForRun(task.id, "run-3");
    expect(won3).toBe(true);
  });
});

describe("Stage CRUD", () => {
  it("createStage appends to the end with auto position", () => {
    const project = createProject("Demo")!;
    const board = getBoardForProject(project.id)!;
    const stage = createStage(board.id, { name: "QA" });
    const stages = listStagesForBoard(board.id);
    expect(stages.map(s => s.name)).toEqual(["To Do", "Doing", "Review", "Done", "QA"]);
    expect(stage.position).toBe(4);
  });

  it("deleteStage refuses when active tasks are in it", () => {
    const project = createProject("Demo")!;
    const board = getBoardForProject(project.id)!;
    const stages = listStagesForBoard(board.id);
    const todo = stages.find(s => s.name === "To Do")!;
    createTask({ boardId: board.id, stageId: todo.id, title: "Card" });
    const result = deleteStage(todo.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/active task/);
  });

  it("deleteStage refuses when a job watches it", () => {
    const project = createProject("Demo")!;
    const board = getBoardForProject(project.id)!;
    const stages = listStagesForBoard(board.id);
    const review = stages.find(s => s.name === "Review")!;
    const agent = createAgent("rev", "");
    createJob(agent.id, {
      name: "Reviewer",
      schedule: "{}",
      triggerKind: "task_stage",
      watchedStageId: review.id,
    });
    expect(countJobsWatching(review.id)).toBe(1);
    const result = deleteStage(review.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/job/);
  });

  it("setStageTransitions replaces the outgoing edges atomically", () => {
    const project = createProject("Demo")!;
    const board = getBoardForProject(project.id)!;
    const stages = listStagesForBoard(board.id);
    const todo = stages.find(s => s.name === "To Do")!;
    const review = stages.find(s => s.name === "Review")!;
    const done = stages.find(s => s.name === "Done")!;

    setStageTransitions(todo.id, [review.id, done.id]);
    expect(isTransitionLegal(todo.id, review.id)).toBe(true);
    expect(isTransitionLegal(todo.id, done.id)).toBe(true);
    expect(isTransitionLegal(todo.id, stages.find(s => s.name === "Doing")!.id)).toBe(false);
  });
});

describe("Task-triggered job picks up tasks via getAgentNextRun", () => {
  it("picks a task from the watched stage and binds it to the run", () => {
    const project = createProject("Demo")!;
    const board = getBoardForProject(project.id)!;
    const stages = listStagesForBoard(board.id);
    const todo = stages.find(s => s.name === "To Do")!;

    const agent = createAgent("writer", "");
    createJob(agent.id, {
      name: "Writer",
      schedule: "{}",
      triggerKind: "task_stage",
      watchedStageId: todo.id,
      instructions: "Write copy.",
    });

    const task = createTask({ boardId: board.id, stageId: todo.id, title: "Write something" });

    const payload = getAgentNextRun(agent.id);
    expect(payload).not.toBeNull();
    expect(payload!.run.task_id).toBe(task.id);
    expect(payload!.task).toBeDefined();
    expect(payload!.task.id).toBe(task.id);
    expect(payload!.task.title).toBe("Write something");
    expect(payload!.task.legal_transitions.map((t: any) => t.name)).toContain("Doing");

    expect(hasActiveTaskClaim(agent.id, task.id)).toBe(true);
    const secondPayload = getAgentNextRun(agent.id);
    expect(secondPayload).toBeNull();
  });

  it("'done' is rejected if the task hasn't been moved", () => {
    const project = createProject("Demo")!;
    const board = getBoardForProject(project.id)!;
    const stages = listStagesForBoard(board.id);
    const todo = stages.find(s => s.name === "To Do")!;

    const agent = createAgent("writer", "");
    createJob(agent.id, {
      name: "Writer",
      schedule: "{}",
      triggerKind: "task_stage",
      watchedStageId: todo.id,
    });
    createTask({ boardId: board.id, stageId: todo.id, title: "Card" });

    const payload = getAgentNextRun(agent.id);
    const runId = payload!.run.id;

    const error = validateRunStatusTransition(runId, "done");
    expect(error).toMatch(/Task is still in the watched stage/);

    const doing = stages.find(s => s.name === "Doing")!;
    const move = moveTaskToStage(payload!.run.task_id!, doing.id, {
      authorType: "agent",
      authorId: agent.id,
      authorName: "writer",
      runId,
    });
    expect(move.ok).toBe(true);
    expect(validateRunStatusTransition(runId, "done")).toBeNull();
  });

  it("failed/skipped runs release the task claim", () => {
    const project = createProject("Demo")!;
    const board = getBoardForProject(project.id)!;
    const stages = listStagesForBoard(board.id);
    const todo = stages.find(s => s.name === "To Do")!;

    const agent = createAgent("writer", "");
    createJob(agent.id, {
      name: "Writer",
      schedule: "{}",
      triggerKind: "task_stage",
      watchedStageId: todo.id,
    });
    const task = createTask({ boardId: board.id, stageId: todo.id, title: "Card" });

    const payload = getAgentNextRun(agent.id);
    const runId = payload!.run.id;

    updateRunStatus(runId, "failed");
    const next = getAgentNextRun(agent.id);
    expect(next).not.toBeNull();
    expect(next!.run.task_id).toBe(task.id);
  });
});

describe("Top-level (project-less) board flow", () => {
  it("can create tasks on the top-level board without any project", () => {
    const top = getTopLevelBoard()!;
    const stages = listStagesForBoard(top.id);
    const todo = stages.find(s => s.name === "To Do")!;
    const task = createTask({ boardId: top.id, stageId: todo.id, title: "Solo task" });
    expect(task.board_id).toBe(top.id);
    expect(listTasksByBoard(top.id)).toHaveLength(1);
  });
});
