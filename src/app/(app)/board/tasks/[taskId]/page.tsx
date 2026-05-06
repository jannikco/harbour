"use client";

import { useState, useRef, use } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { BackLink } from "@/components/app/back-link";
import { AttachmentComposer, type AttachmentComposerHandle } from "@/components/app/attachment-composer";
import { AttachmentList } from "@/components/app/attachment-display";
import type { SerializedAttachment } from "@/lib/attachments-serialize";
import { ArrowRight, Bot, Loader2, MessageSquare, User as UserIcon, Cpu, ChevronRight, Trash2 } from "lucide-react";
import { timeAgo } from "@/lib/time";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

type TaskActivity = {
  id: string;
  task_id: string;
  run_id: string | null;
  kind: "comment" | "stage_change" | "created" | "claimed" | "released";
  from_stage_id: string | null;
  to_stage_id: string | null;
  from_stage_name: string | null;
  to_stage_name: string | null;
  author_type: "user" | "agent" | "system";
  author_id: string | null;
  author_name: string | null;
  content: string | null;
  created_at: number;
};

type TaskDetail = {
  id: string;
  board_id: string;
  board_name: string;
  project_id: string | null;
  project_name: string | null;
  stage_id: string;
  stage_name: string;
  title: string;
  description: string | null;
  position: number;
  claimed_by_run_id: string | null;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
  activity: TaskActivity[];
};

type StageWithTransitions = {
  id: string;
  name: string;
  is_terminal: number;
  transitions_to: string[];
  jobs_watching: number;
};

export default function TaskDetailPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = use(params);
  const queryClient = useQueryClient();

  const { data: task, isLoading } = useQuery<TaskDetail>({
    queryKey: ["task", taskId],
    queryFn: async () => {
      const res = await fetch(`/api/tasks/${taskId}`);
      if (!res.ok) throw new Error("not found");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: stages = [] } = useQuery<StageWithTransitions[]>({
    queryKey: ["stages", task?.board_id],
    queryFn: async () => {
      if (!task) return [];
      const res = await fetch(`/api/boards/${task.board_id}/stages`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!task,
  });

  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const composerRef = useRef<AttachmentComposerHandle>(null);

  const { data: attachments = [] } = useQuery<SerializedAttachment[]>({
    queryKey: ["task-attachments", taskId],
    queryFn: async () => {
      const res = await fetch(`/api/tasks/${taskId}/attachments`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 5000,
  });

  if (isLoading) return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;
  if (!task) return <div className="text-sm text-muted-foreground py-12 text-center">Task not found.</div>;

  async function deleteAttachment(att: SerializedAttachment) {
    if (!confirm(`Delete ${att.filename || att.title || "attachment"}?`)) return;
    const res = await fetch(`/api/tasks/${taskId}/attachments/${att.id}`, { method: "DELETE" });
    if (!res.ok) return alert("Delete failed");
    queryClient.invalidateQueries({ queryKey: ["task-attachments", taskId] });
  }

  const stageById: Record<string, StageWithTransitions> = {};
  for (const s of stages) stageById[s.id] = s;

  const currentStage = stageById[task.stage_id];
  const legalTargets = currentStage ? currentStage.transitions_to.map(id => stageById[id]).filter(Boolean) : [];
  const claimed = !!task.claimed_by_run_id;

  async function moveStage(toStageId: string) {
    const res = await fetch(`/api/tasks/${taskId}/stage`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toStageId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "move failed" }));
      alert(err.error || "Move failed");
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    queryClient.invalidateQueries({ queryKey: ["board", task!.board_id] });
    queryClient.invalidateQueries({ queryKey: ["boards"] });
  }

  async function postComment(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = comment.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    const res = await fetch(`/api/tasks/${taskId}/activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: trimmed }),
    });
    setPosting(false);
    if (!res.ok) {
      alert("Failed to post comment");
      return;
    }
    setComment("");
    queryClient.invalidateQueries({ queryKey: ["task", taskId] });
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <BackLink href="/board" label="Back to board" />

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{task.project_name ?? task.board_name}</span>
          <ChevronRight className="h-3 w-3" />
          <Badge variant="outline" className="text-[10px]">{task.stage_name}</Badge>
          {claimed && (
            <Badge className="text-[10px] bg-amber-500/10 text-amber-600 hover:bg-amber-500/10">
              <Bot className="h-3 w-3 mr-0.5" /> claimed
            </Badge>
          )}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{task.title}</h1>
        {task.description && (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.description}</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={claimed}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 h-8 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none"
          >
            <ArrowRight className="h-3.5 w-3.5 mr-1.5" />
            Move to...
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {legalTargets.length === 0 ? (
              <DropdownMenuItem disabled>No legal moves</DropdownMenuItem>
            ) : (
              legalTargets.map(t => (
                <DropdownMenuItem key={t.id} onClick={() => moveStage(t.id)}>
                  <ChevronRight className="h-3.5 w-3.5 mr-1" />
                  {t.name}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {claimed && (
          <span className="text-xs text-muted-foreground">Locked while an agent works</span>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Attachments
          {attachments.length > 0 && (
            <span className="ml-1.5 text-muted-foreground/70">({attachments.length})</span>
          )}
        </h2>
        {attachments.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {attachments.map(att => (
              <div key={att.id} className="group relative">
                <AttachmentList items={[att]} />
                <button
                  type="button"
                  onClick={() => deleteAttachment(att)}
                  className="absolute top-1 right-1 rounded p-1 bg-background/80 backdrop-blur opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all"
                  title="Delete attachment"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <AttachmentComposer
          ref={composerRef}
          parent={{ type: "task", id: taskId }}
          onStagedIdsChange={() => queryClient.invalidateQueries({ queryKey: ["task-attachments", taskId] })}
        />
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Activity
        </h2>
        {task.activity.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
            No activity yet.
          </div>
        ) : (
          <ol className="space-y-3">
            {task.activity.map(a => <ActivityRow key={a.id} a={a} />)}
          </ol>
        )}
      </div>

      <form onSubmit={postComment} className="space-y-2">
        <Textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="Add a comment..."
          rows={3}
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={posting || !comment.trim()}>
            {posting && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Post comment
          </Button>
        </div>
      </form>
    </div>
  );
}

function ActivityRow({ a }: { a: TaskActivity }) {
  const Icon =
    a.author_type === "agent" ? Cpu :
    a.author_type === "user" ? UserIcon :
    MessageSquare;

  let header: React.ReactNode = null;
  if (a.kind === "stage_change") {
    header = (
      <span>
        <span className="font-medium">{a.author_name ?? "Someone"}</span>
        {" moved from "}
        <Badge variant="outline" className="text-[10px] mx-0.5">{a.from_stage_name ?? "?"}</Badge>
        {" to "}
        <Badge variant="outline" className="text-[10px] mx-0.5">{a.to_stage_name ?? "?"}</Badge>
      </span>
    );
  } else if (a.kind === "created") {
    header = (
      <span>
        <span className="font-medium">{a.author_name ?? "Someone"}</span>
        {" created the task in "}
        <Badge variant="outline" className="text-[10px]">{a.to_stage_name ?? "?"}</Badge>
      </span>
    );
  } else if (a.kind === "claimed") {
    header = <span>Claimed by an agent run</span>;
  } else if (a.kind === "comment") {
    header = <span className="font-medium">{a.author_name ?? "Someone"} commented</span>;
  } else {
    header = <span className="text-muted-foreground">{a.kind}</span>;
  }

  return (
    <li className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm">
          {header}
          <span className="text-xs text-muted-foreground ml-2">{timeAgo(a.created_at)}</span>
        </div>
        {a.content && (
          <div className="mt-1 rounded-md bg-muted/40 p-2.5 text-sm whitespace-pre-wrap">
            {a.content}
          </div>
        )}
        {a.run_id && (
          <Link href={`/runs/${a.run_id}`} className="text-xs text-primary mt-1 inline-block hover:underline">
            View run →
          </Link>
        )}
      </div>
    </li>
  );
}
