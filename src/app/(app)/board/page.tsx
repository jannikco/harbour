"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/app/empty-state";
import { useApp } from "@/components/app/app-context";
import { useActiveProjectId } from "@/lib/hooks/use-project-filter";
import { Plus, KanbanSquare, Bot, Settings, MoreHorizontal, ChevronRight } from "lucide-react";
import { CreateTaskDialog } from "@/components/app/create-task-dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";

type StageWithTasks = {
  id: string;
  board_id: string;
  name: string;
  position: number;
  is_terminal: number;
  jobs_watching: number;
  transitions_to: string[];
  tasks: Task[];
};

type Task = {
  id: string;
  board_id: string;
  stage_id: string;
  stage_name: string;
  title: string;
  description: string | null;
  position: number;
  claimed_by_run_id: string | null;
  claimed_run_agent_name: string | null;
  archived_at: number | null;
  created_at: number;
};

type Board = {
  id: string;
  name: string;
  project_id: string | null;
  project_name: string | null;
  stage_count: number;
  task_count: number;
};

type BoardData = {
  board: { id: string; name: string; project_id: string | null };
  stages: StageWithTasks[];
};

export default function BoardPage() {
  const projectId = useActiveProjectId();
  const { setActiveProjectId } = useApp();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const explicitBoardId = searchParams.get("boardId");

  // Always fetch all boards — needed to decide whether to render the index
  // (multiple boards in All Projects mode) vs a single board view.
  const { data: boards = [], isLoading: boardsLoading } = useQuery<Board[]>({
    queryKey: ["boards"],
    queryFn: async () => {
      const res = await fetch("/api/boards");
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 10000,
  });

  // Resolve which board to render (if any). Rules:
  // - ?boardId=X in URL → that specific board (used for top-level navigation)
  // - Active project → that project's board
  // - No active project + exactly 1 board total → that board
  // - Otherwise (no active project + 2+ boards) → render index instead
  const activeBoard = useMemo<Board | null>(() => {
    if (boards.length === 0) return null;
    if (explicitBoardId) {
      return boards.find(b => b.id === explicitBoardId) ?? null;
    }
    if (projectId) {
      const match = boards.find(b => b.project_id === projectId);
      if (match) return match;
      // Stale activeProjectId (e.g. project deleted while the cleanup hook
      // races) — fall through to the default resolution rules.
    }
    if (boards.length === 1) return boards[0];
    return null;
  }, [boards, projectId, explicitBoardId]);

  const showIndex = !boardsLoading && !activeBoard && boards.length > 1;
  const showEmpty = !boardsLoading && boards.length === 0;

  if (showEmpty) {
    return <CreateFirstBoard onCreated={() => queryClient.invalidateQueries({ queryKey: ["boards"] })} />;
  }

  if (showIndex) {
    return <BoardsIndex boards={boards} setActiveProjectId={setActiveProjectId} />;
  }

  if (!activeBoard) {
    return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;
  }

  return (
    <BoardView
      board={activeBoard}
      onChange={() => queryClient.invalidateQueries({ queryKey: ["boards"] })}
    />
  );
}

function CreateFirstBoard({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("Tasks");
  const [creating, setCreating] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    const res = await fetch("/api/boards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), projectId: null }),
    });
    setCreating(false);
    if (!res.ok) return alert("Failed to create board");
    onCreated();
  }

  return (
    <div className="max-w-md mx-auto pt-12 space-y-4">
      <EmptyState large icon={<KanbanSquare className="h-10 w-10 text-muted-foreground/40" />}>
        <div className="space-y-3 mt-2">
          <p>Create your first board to get started.</p>
        </div>
      </EmptyState>
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Board name"
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
          autoFocus
        />
        <Button type="submit" disabled={creating || !name.trim()}>
          {creating ? "Creating..." : "Create board"}
        </Button>
      </form>
    </div>
  );
}

function BoardsIndex({
  boards,
  setActiveProjectId,
}: {
  boards: Board[];
  setActiveProjectId: (id: string | null) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Boards</h1>
        <p className="text-sm text-muted-foreground mt-1">All boards across your projects.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {boards.map(b => (
          <Link
            key={b.id}
            href={b.project_id ? "/board" : `/board?boardId=${b.id}`}
            onClick={() => {
              // Project boards: set active project so the sidebar filters
              // everything to that project. Top-level boards: clear active
              // project (the URL's boardId param drives the view).
              setActiveProjectId(b.project_id);
            }}
            className="rounded-lg border bg-card p-4 hover:border-primary/30 transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <KanbanSquare className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{b.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {b.project_name ? b.project_name : "Top-level"}
                </div>
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                  <span>{b.task_count} task{b.task_count === 1 ? "" : "s"}</span>
                  <span>{b.stage_count} stage{b.stage_count === 1 ? "" : "s"}</span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function BoardView({ board, onChange }: { board: { id: string; name: string; project_id: string | null }; onChange: () => void }) {
  const queryClient = useQueryClient();
  const [createTarget, setCreateTarget] = useState<{ stageId: string; stageName: string } | null>(null);
  const [activeDragTask, setActiveDragTask] = useState<Task | null>(null);

  const queryKey = useMemo(() => ["board", board.id], [board.id]);

  // Pointer sensor with a small distance threshold so card clicks (open task
  // detail) still work without the drag handler swallowing them.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const { data, isLoading } = useQuery<BoardData>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/boards/${board.id}`);
      if (!res.ok) throw new Error("not found");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const moveTaskApi = useCallback(async (task: Task, toStageId: string) => {
    const res = await fetch(`/api/tasks/${task.id}/stage`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toStageId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "move failed" }));
      throw new Error(err.error || "Move failed");
    }
  }, []);

  const handleMenuMove = useCallback(async (task: Task, toStageId: string) => {
    try {
      await moveTaskApi(task, toStageId);
    } catch (e: any) {
      alert(e.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ["boards"] });
  }, [moveTaskApi, queryClient, queryKey]);

  const handleDelete = useCallback(async (task: Task) => {
    if (!confirm(`Delete task "${task.title}"?`)) return;
    const res = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
    if (!res.ok) return alert("Delete failed");
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ["boards"] });
    onChange();
  }, [queryClient, queryKey, onChange]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    if (!data) return;
    const taskId = event.active.id as string;
    for (const stage of data.stages) {
      const t = stage.tasks.find(t => t.id === taskId);
      if (t) { setActiveDragTask(t); return; }
    }
  }, [data]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveDragTask(null);
    if (!data || !event.over) return;

    const taskId = event.active.id as string;
    const targetStageId = event.over.id as string;

    // Find the task in current data
    let task: Task | undefined;
    let sourceStage: StageWithTasks | undefined;
    for (const stage of data.stages) {
      const t = stage.tasks.find(t => t.id === taskId);
      if (t) { task = t; sourceStage = stage; break; }
    }
    if (!task || !sourceStage) return;
    if (sourceStage.id === targetStageId) return;

    // Client-side legality check — gives instant feedback without a 409 round-trip
    if (!sourceStage.transitions_to.includes(targetStageId)) {
      alert(`Can't move from "${sourceStage.name}" to that stage — not allowed by the board.`);
      return;
    }
    if (task.claimed_by_run_id) {
      alert("Task is locked while an agent works on it.");
      return;
    }

    // Optimistic: remove from source, append to target
    const previous = queryClient.getQueryData<BoardData>(queryKey);
    queryClient.setQueryData<BoardData>(queryKey, prev => {
      if (!prev) return prev;
      return {
        ...prev,
        stages: prev.stages.map(s => {
          if (s.id === sourceStage!.id) return { ...s, tasks: s.tasks.filter(t => t.id !== taskId) };
          if (s.id === targetStageId) return { ...s, tasks: [...s.tasks, { ...task!, stage_id: targetStageId }] };
          return s;
        }),
      };
    });

    try {
      await moveTaskApi(task, targetStageId);
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["boards"] });
    } catch (e: any) {
      // Rollback
      queryClient.setQueryData(queryKey, previous);
      alert(e.message);
    }
  }, [data, queryClient, queryKey, moveTaskApi]);

  if (isLoading || !data) {
    return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;
  }

  const stageById: Record<string, StageWithTasks> = {};
  for (const s of data.stages) stageById[s.id] = s;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{data.board.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {data.board.project_id ? "Project board" : "Top-level board"}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/board/config">
            <Button variant="outline" size="sm">
              <Settings className="h-4 w-4 mr-1.5" /> Configure stages
            </Button>
          </Link>
        </div>
      </div>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
          {data.stages.map(stage => (
            <StageColumn
              key={stage.id}
              stage={stage}
              stageById={stageById}
              activeDragTask={activeDragTask}
              onAddTask={() => setCreateTarget({ stageId: stage.id, stageName: stage.name })}
              onMenuMove={handleMenuMove}
              onDelete={handleDelete}
            />
          ))}
        </div>
        <DragOverlay>
          {activeDragTask ? <TaskCardPreview task={activeDragTask} /> : null}
        </DragOverlay>
      </DndContext>

      {createTarget && (
        <CreateTaskDialog
          open={!!createTarget}
          onOpenChange={open => { if (!open) setCreateTarget(null); }}
          boardId={board.id}
          stageId={createTarget.stageId}
          stageName={createTarget.stageName}
          onCreated={() => {
            queryClient.invalidateQueries({ queryKey });
            queryClient.invalidateQueries({ queryKey: ["boards"] });
          }}
        />
      )}
    </div>
  );
}

function StageColumn({
  stage,
  stageById,
  activeDragTask,
  onAddTask,
  onMenuMove,
  onDelete,
}: {
  stage: StageWithTasks;
  stageById: Record<string, StageWithTasks>;
  activeDragTask: Task | null;
  onAddTask: () => void;
  onMenuMove: (task: Task, toStageId: string) => void;
  onDelete: (task: Task) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  // Highlight the column when the dragged task can legally land here.
  const sourceStage = activeDragTask
    ? Object.values(stageById).find(s => s.tasks.some(t => t.id === activeDragTask.id))
    : null;
  const isLegalTarget = sourceStage && sourceStage.id !== stage.id
    ? sourceStage.transitions_to.includes(stage.id)
    : false;
  const isIllegalHover = activeDragTask && isOver && !isLegalTarget && sourceStage?.id !== stage.id;

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col min-w-[280px] max-w-[320px] flex-1 rounded-lg border bg-muted/30 p-2.5 transition-colors ${
        isOver && isLegalTarget ? "border-primary/60 bg-primary/5" : ""
      } ${isIllegalHover ? "border-destructive/40 bg-destructive/5" : ""} ${
        activeDragTask && isLegalTarget && !isOver ? "border-primary/30 border-dashed" : ""
      }`}
    >
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">{stage.name}</h3>
          {stage.is_terminal === 1 && (
            <Badge variant="outline" className="text-[10px]">terminal</Badge>
          )}
          <span className="text-xs text-muted-foreground">{stage.tasks.length}</span>
        </div>
        <button
          onClick={onAddTask}
          className="text-muted-foreground hover:text-foreground"
          title="Add task"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {stage.jobs_watching > 0 && (
        <div className="px-1 pb-1.5 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Bot className="h-3 w-3" />
            {stage.jobs_watching} job{stage.jobs_watching === 1 ? "" : "s"} watching
          </span>
        </div>
      )}
      <div className="flex flex-col gap-2 min-h-[40px]">
        {stage.tasks.length === 0 ? (
          <div className="text-xs text-muted-foreground/50 px-1 py-2 text-center">
            No tasks
          </div>
        ) : (
          stage.tasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              stage={stage}
              stageById={stageById}
              isDragging={activeDragTask?.id === task.id}
              onMenuMove={onMenuMove}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TaskCard({
  task,
  stage,
  stageById,
  isDragging,
  onMenuMove,
  onDelete,
}: {
  task: Task;
  stage: StageWithTasks;
  stageById: Record<string, StageWithTasks>;
  isDragging: boolean;
  onMenuMove: (task: Task, toStageId: string) => void;
  onDelete: (task: Task) => void;
}) {
  const claimed = !!task.claimed_by_run_id;
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: task.id,
    disabled: claimed,
  });

  const legalTargets = stage.transitions_to
    .map(id => stageById[id])
    .filter(Boolean);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`group relative rounded-md border bg-background p-2.5 hover:border-primary/30 transition-colors ${
        claimed ? "ring-1 ring-amber-500/30" : "cursor-grab active:cursor-grabbing"
      } ${isDragging ? "opacity-30" : ""}`}
    >
      <Link href={`/board/tasks/${task.id}`} className="block" onClick={e => e.stopPropagation()}>
        <div className="text-sm font-medium leading-snug pr-6">{task.title}</div>
        {task.description && (
          <div className="text-xs text-muted-foreground line-clamp-2 mt-1">
            {task.description}
          </div>
        )}
        {claimed && task.claimed_run_agent_name && (
          <div className="mt-2 inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-500">
            <Bot className="h-3 w-3" /> {task.claimed_run_agent_name} working
          </div>
        )}
      </Link>
      <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="rounded p-1 hover:bg-accent"
            onPointerDown={e => e.stopPropagation()}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {legalTargets.length === 0 ? (
              <DropdownMenuItem disabled>No legal moves</DropdownMenuItem>
            ) : (
              legalTargets.map(t => (
                <DropdownMenuItem
                  key={t.id}
                  onClick={() => onMenuMove(task, t.id)}
                  disabled={claimed}
                >
                  <ChevronRight className="h-3.5 w-3.5 mr-1" />
                  Move to {t.name}
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDelete(task)}
              disabled={claimed}
              variant="destructive"
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** Shown in the DragOverlay — a static visual of the card following the cursor. */
function TaskCardPreview({ task }: { task: Task }) {
  return (
    <div className="rounded-md border bg-background p-2.5 shadow-lg ring-2 ring-primary/40 cursor-grabbing max-w-[300px]">
      <div className="text-sm font-medium leading-snug">{task.title}</div>
      {task.description && (
        <div className="text-xs text-muted-foreground line-clamp-2 mt-1">{task.description}</div>
      )}
    </div>
  );
}
