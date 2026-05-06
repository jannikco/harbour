"use client";

import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { AlertCircle, Loader2, Paperclip, Plus, X } from "lucide-react";
import { uploadFile } from "@/lib/upload-client";

type StagedFile = { file: File; error?: string };

export function CreateTaskDialog({
  open,
  onOpenChange,
  boardId,
  stageId,
  stageName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  stageId: string;
  stageName: string;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const stagedRef = useRef<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingMessage, setUploadingMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setStaged([]);
      stagedRef.current = [];
      setUploadingMessage(null);
    }
  }, [open]);

  function addFiles(input: FileList | File[]) {
    // The task doesn't exist yet, so we just hold the File objects until the
    // task is created — then we upload them to the new task's id.
    const files = Array.from(input);
    setStaged(prev => {
      const next = [...prev, ...files.map(f => ({ file: f } as StagedFile))];
      stagedRef.current = next.filter(s => !s.error).map(s => s.file);
      return next;
    });
  }

  function removeStaged(index: number) {
    setStaged(prev => {
      const next = prev.filter((_, i) => i !== index);
      stagedRef.current = next.filter(s => !s.error).map(s => s.file);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);

    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        boardId,
        stageId,
        title: title.trim(),
        description: description.trim() || undefined,
      }),
    });
    if (!res.ok) {
      setSubmitting(false);
      alert("Failed to create task");
      return;
    }
    const task = await res.json();

    // Now upload any staged files to the newly-created task.
    const files = stagedRef.current;
    if (files.length > 0) {
      setUploadingMessage(`Uploading ${files.length} file${files.length === 1 ? "" : "s"}...`);
      const errors: string[] = [];
      for (const file of files) {
        try {
          await uploadFile({ type: "task", id: task.id }, file).promise;
        } catch (err: any) {
          errors.push(`${file.name}: ${err.message || "upload failed"}`);
        }
      }
      if (errors.length > 0) {
        alert(`Some files failed to upload:\n${errors.join("\n")}`);
      }
    }

    setSubmitting(false);
    setUploadingMessage(null);
    onCreated();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Task in {stageName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Write blog post about new feature"
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Details, links, requirements..."
              rows={5}
              className="max-h-[40vh]"
            />
          </div>

          <div className="rounded-lg border bg-muted/40 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Paperclip className="h-3.5 w-3.5" />
                Attachments
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
              >
                <Plus className="h-3 w-3" /> Add
              </button>
            </div>
            {staged.length === 0 ? (
              <p className="text-xs text-muted-foreground mt-1.5">No files attached.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {staged.map((entry, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
                      entry.error ? "bg-destructive/10 border border-destructive/30" : "bg-background border"
                    }`}
                  >
                    {entry.error ? (
                      <AlertCircle className="h-3 w-3 text-destructive" />
                    ) : (
                      <Paperclip className="h-3 w-3 text-muted-foreground" />
                    )}
                    <span className="truncate max-w-[150px]">{entry.file.name}</span>
                    {entry.error && <span className="text-destructive text-[10px]">{entry.error}</span>}
                    <button
                      type="button"
                      onClick={() => removeStaged(i)}
                      className="text-muted-foreground hover:text-foreground transition-colors ml-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !title.trim()}>
              {submitting && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              {uploadingMessage ?? (submitting ? "Creating..." : "Create Task")}
            </Button>
          </DialogFooter>
        </form>

        {/* File input rendered outside the visible flow */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ position: "fixed", top: -100, left: -100, opacity: 0 }}
          onChange={e => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
