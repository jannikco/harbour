"use client";

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { BackLink } from "@/components/app/back-link";
import { useActiveProjectId } from "@/lib/hooks/use-project-filter";
import { ArrowDown, ArrowUp, Bot, Loader2, Plus, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";

type Stage = {
  id: string;
  name: string;
  position: number;
  is_terminal: number;
  transitions_to: string[];
  jobs_watching: number;
};

export default function BoardConfigPage() {
  const projectId = useActiveProjectId();
  const queryClient = useQueryClient();
  const [newStageName, setNewStageName] = useState("");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftTransitions, setDraftTransitions] = useState<Record<string, string[]>>({});
  const [draftOrder, setDraftOrder] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  const { data: stages = [] } = useQuery<Stage[]>({
    queryKey: ["stages", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const res = await fetch(`/api/projects/${projectId}/stages`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectId,
  });

  // Sync draft state from server-fetched stages whenever the data changes and
  // the user hasn't started editing.
  useEffect(() => {
    if (!stages || dirty) return;
    const t: Record<string, string[]> = {};
    for (const s of stages) t[s.id] = s.transitions_to;
    setDraftTransitions(t);
    setDraftOrder(stages.map(s => s.id));
  }, [stages, dirty]);

  if (!projectId) {
    return (
      <EmptyState large>Select a project first.</EmptyState>
    );
  }

  function toggleTransition(fromId: string, toId: string) {
    setDirty(true);
    setDraftTransitions(prev => {
      const cur = new Set(prev[fromId] ?? []);
      if (cur.has(toId)) cur.delete(toId);
      else cur.add(toId);
      return { ...prev, [fromId]: Array.from(cur) };
    });
  }

  function moveStage(stageId: string, dir: -1 | 1) {
    setDirty(true);
    setDraftOrder(prev => {
      const idx = prev.indexOf(stageId);
      if (idx < 0) return prev;
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  async function saveBoardLayout() {
    if (saving) return;
    setSaving(true);
    const res = await fetch(`/api/projects/${projectId}/stages`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order: draftOrder,
        transitions: draftTransitions,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "save failed" }));
      alert(err.error || "Save failed");
      return;
    }
    setDirty(false);
    queryClient.invalidateQueries({ queryKey: ["stages", projectId] });
  }

  async function createStage(e: React.FormEvent) {
    e.preventDefault();
    const name = newStageName.trim();
    if (!name || creating) return;
    setCreating(true);
    const res = await fetch(`/api/projects/${projectId}/stages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setCreating(false);
    if (!res.ok) {
      alert("Failed to create stage");
      return;
    }
    setNewStageName("");
    setDirty(false);
    queryClient.invalidateQueries({ queryKey: ["stages", projectId] });
  }

  async function deleteStage(stage: Stage) {
    if (!confirm(`Delete stage "${stage.name}"?`)) return;
    const res = await fetch(`/api/projects/${projectId}/stages/${stage.id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "delete failed" }));
      alert(err.error || "Delete failed");
      return;
    }
    setDirty(false);
    queryClient.invalidateQueries({ queryKey: ["stages", projectId] });
  }

  async function toggleTerminal(stage: Stage) {
    const res = await fetch(`/api/projects/${projectId}/stages/${stage.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_terminal: !stage.is_terminal }),
    });
    if (!res.ok) {
      alert("Failed to update stage");
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["stages", projectId] });
  }

  async function renameStage(stage: Stage, newName: string) {
    if (newName === stage.name || !newName.trim()) return;
    const res = await fetch(`/api/projects/${projectId}/stages/${stage.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    if (!res.ok) {
      alert("Failed to rename stage");
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["stages", projectId] });
  }

  // Render in draft order if dirty, otherwise server order
  const stageById: Record<string, Stage> = {};
  for (const s of stages) stageById[s.id] = s;
  const orderedStages = draftOrder.map(id => stageById[id]).filter(Boolean);

  return (
    <div className="space-y-6 max-w-4xl">
      <BackLink href="/board" label="Back to board" />

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Configure stages</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Stages are columns on the board. Transitions define which moves are allowed.
          </p>
        </div>
        {dirty && (
          <Button onClick={saveBoardLayout} disabled={saving} size="sm">
            {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Save changes
          </Button>
        )}
      </div>

      <form onSubmit={createStage} className="flex gap-2">
        <Input
          value={newStageName}
          onChange={e => setNewStageName(e.target.value)}
          placeholder="New stage name (e.g. QA)"
          className="flex-1"
        />
        <Button type="submit" size="sm" disabled={creating || !newStageName.trim()}>
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add stage
        </Button>
      </form>

      <div className="space-y-3">
        {orderedStages.map((stage, idx) => (
          <div key={stage.id} className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex flex-col gap-0.5 mt-1">
                <button
                  onClick={() => moveStage(stage.id, -1)}
                  disabled={idx === 0}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Move up"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => moveStage(stage.id, 1)}
                  disabled={idx === orderedStages.length - 1}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Move down"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    defaultValue={stage.name}
                    className="text-sm font-medium max-w-xs"
                    onBlur={e => renameStage(stage, e.target.value.trim())}
                  />
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={stage.is_terminal === 1}
                      onChange={() => toggleTerminal(stage)}
                      className="rounded"
                    />
                    Terminal
                  </label>
                  {stage.jobs_watching > 0 && (
                    <Badge className="text-[10px] bg-blue-500/10 text-blue-600 hover:bg-blue-500/10">
                      <Bot className="h-3 w-3 mr-0.5" />
                      {stage.jobs_watching} watching
                    </Badge>
                  )}
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Allowed moves to:
                  </Label>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {orderedStages.filter(s => s.id !== stage.id).map(target => {
                      const enabled = (draftTransitions[stage.id] ?? []).includes(target.id);
                      return (
                        <button
                          key={target.id}
                          type="button"
                          onClick={() => toggleTransition(stage.id, target.id)}
                          className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border transition-colors ${
                            enabled
                              ? "bg-primary/10 text-primary border-primary/30"
                              : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted"
                          }`}
                        >
                          → {target.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <button
                onClick={() => deleteStage(stage)}
                className="text-muted-foreground hover:text-destructive transition-colors"
                title="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
