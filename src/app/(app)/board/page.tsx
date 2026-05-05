"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/app/empty-state";
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

type StageWithTasks = {
  id: string;
  project_id: string;
  name: string;
  position: number;
  is_terminal: number;
  jobs_watching: number;
  transitions_to: string[];
  tasks: Task[];
};

type Task = {
  id: string;
  project_id: string;
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

type BoardData = {
  project: { id: string; name: string };
  stages: StageWithTasks[];
};

export default function BoardPage() {
  const projectId = useActiveProjectId();
  const queryClient = useQueryClient();
  const [createTarget, setCreateTarget] = useState<{ stageId: string; stageName: string } | null>(null);

  const { data, isLoading } = useQuery<BoardData>({
    queryKey: ["board", projectId],
    queryFn: async () => {
      if (!projectId) return null as any;
      const res = await fetch(`/api/projects/${projectId}/board`);
      if (!res.ok) return null as any;
      return res.json();
    },
    enabled: !!projectId,
    refetchInterval: 5000,
  });

  if (!projectId) {
    return (
      <EmptyState large icon={<KanbanSquare className="h-10 w-10 text-muted-foreground/40" />}>
        Select a project to see its board.
      </EmptyState>
    );
  }

  if (isLoading || !data) {
    return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;
  }

  async function moveTask(task: Task, toStageId: string) {
    const res = await fetch(`/api/tasks/${task.id}/stage`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toStageId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "move failed" }));
      alert(err.error || "Move failed");
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["board", projectId] });
  }

  async function deleteTask(task: Task) {
    if (!confirm(`Delete task "${task.title}"?`)) return;
    const res = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
    if (!res.ok) {
      alert("Delete failed");
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["board", projectId] });
  }

  const stageById: Record<string, StageWithTasks> = {};
  for (const s of data.stages) stageById[s.id] = s;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Board</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tasks for <span className="font-medium text-foreground">{data.project.name}</span>.
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

      <div className="flex gap-3 overflow-x-auto pb-4">
        {data.stages.map(stage => (
          <div key={stage.id} className="flex flex-col min-w-[280px] max-w-[320px] flex-1 rounded-lg border bg-muted/30 p-2.5">
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">{stage.name}</h3>
                {stage.is_terminal === 1 && (
                  <Badge variant="outline" className="text-[10px]">terminal</Badge>
                )}
                <span className="text-xs text-muted-foreground">{stage.tasks.length}</span>
              </div>
              <button
                onClick={() => setCreateTarget({ stageId: stage.id, stageName: stage.name })}
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
            <div className="flex flex-col gap-2">
              {stage.tasks.length === 0 ? (
                <div className="text-xs text-muted-foreground/50 px-1 py-2 text-center">
                  No tasks
                </div>
              ) : (
                stage.tasks.map(task => {
                  const legalTargets = stage.transitions_to
                    .map(id => stageById[id])
                    .filter(Boolean);
                  const claimed = !!task.claimed_by_run_id;
                  return (
                    <div
                      key={task.id}
                      className={`group relative rounded-md border bg-background p-2.5 hover:border-primary/30 transition-colors ${claimed ? "ring-1 ring-amber-500/30" : ""}`}
                    >
                      <Link
                        href={`/board/tasks/${task.id}`}
                        className="block"
                      >
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
                          <DropdownMenuTrigger className="rounded p-1 hover:bg-accent">
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {legalTargets.length === 0 ? (
                              <DropdownMenuItem disabled>No legal moves</DropdownMenuItem>
                            ) : (
                              legalTargets.map(t => (
                                <DropdownMenuItem
                                  key={t.id}
                                  onClick={() => moveTask(task, t.id)}
                                  disabled={claimed}
                                >
                                  <ChevronRight className="h-3.5 w-3.5 mr-1" />
                                  Move to {t.name}
                                </DropdownMenuItem>
                              ))
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => deleteTask(task)}
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
                })
              )}
            </div>
          </div>
        ))}
      </div>

      {createTarget && (
        <CreateTaskDialog
          open={!!createTarget}
          onOpenChange={open => { if (!open) setCreateTarget(null); }}
          projectId={projectId}
          stageId={createTarget.stageId}
          stageName={createTarget.stageName}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ["board", projectId] })}
        />
      )}
    </div>
  );
}
