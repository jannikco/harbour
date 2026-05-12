"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Lightbulb, Plus, ExternalLink, Loader2, AlertCircle } from "lucide-react";
import { timeAgo } from "@/lib/time";
import { EmptyState } from "@/components/app/empty-state";
import { useProjectFilter, useActiveProjectId } from "@/lib/hooks/use-project-filter";

type Inspiration = {
  id: string;
  url: string;
  status: "queued" | "processing" | "done" | "failed";
  source_author: string | null;
  source_text: string | null;
  source_reactions: number | null;
  source_comments: number | null;
  error: string | null;
  created_at: number;
  updated_at: number;
};

type Filter = "all" | "queued" | "processing" | "done" | "failed";

function StatusBadge({ status }: { status: Inspiration["status"] }) {
  if (status === "done") {
    return (
      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300">
        Done
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">
        Failed
      </Badge>
    );
  }
  if (status === "processing") {
    return (
      <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300">
        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
        Processing
      </Badge>
    );
  }
  return <Badge variant="secondary">Queued</Badge>;
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/posts\//, "").replace(/^\/feed\/update\//, "");
  } catch {
    return url;
  }
}

export default function InspirationsPage() {
  const queryClient = useQueryClient();
  const projectFilter = useProjectFilter();
  const activeProjectId = useActiveProjectId();
  const [filter, setFilter] = useState<Filter>("all");
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pasteMsg, setPasteMsg] = useState<string | null>(null);

  const { data: inspirations = [], isLoading } = useQuery<Inspiration[]>({
    queryKey: ["inspirations", filter, projectFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("status", filter);
      if (activeProjectId) params.set("projectId", activeProjectId);
      const res = await fetch(`/api/inspirations?${params.toString()}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.inspirations) ? data.inspirations : [];
    },
    refetchInterval: 5000,
  });

  const counts = useMemo(() => {
    return inspirations.reduce(
      (acc, i) => {
        acc.all += 1;
        acc[i.status] = (acc[i.status] || 0) + 1;
        return acc;
      },
      { all: 0, queued: 0, processing: 0, done: 0, failed: 0 } as Record<string, number>,
    );
  }, [inspirations]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const urls = pasteText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (urls.length === 0) {
      setPasteMsg("Paste at least one URL.");
      return;
    }
    setSubmitting(true);
    setPasteMsg(null);
    try {
      const res = await fetch("/api/inspirations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls, projectId: activeProjectId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setPasteMsg(json.error || "Submit failed");
        return;
      }
      const created = json.created?.length || 0;
      const skipped = json.skipped?.length || 0;
      const rejected = json.rejected?.length || 0;
      const parts: string[] = [];
      if (created) parts.push(`${created} queued`);
      if (skipped) parts.push(`${skipped} already in queue`);
      if (rejected) parts.push(`${rejected} not LinkedIn URLs`);
      setPasteMsg(parts.join(" · ") || "Nothing to queue.");
      setPasteText("");
      queryClient.invalidateQueries({ queryKey: ["inspirations"] });
      if (created > 0) {
        setTimeout(() => {
          setShowPaste(false);
          setPasteMsg(null);
        }, 1500);
      }
    } catch (err) {
      setPasteMsg(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) {
    return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inspirations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Paste LinkedIn post URLs. Harbour fetches each one, analyzes it, and drafts content in your voice.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowPaste(true)}>
          <Plus className="h-4 w-4 mr-1" /> Paste URLs
        </Button>
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList>
          <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
          <TabsTrigger value="queued">Queued ({counts.queued || 0})</TabsTrigger>
          <TabsTrigger value="processing">Processing ({counts.processing || 0})</TabsTrigger>
          <TabsTrigger value="done">Done ({counts.done || 0})</TabsTrigger>
          <TabsTrigger value="failed">Failed ({counts.failed || 0})</TabsTrigger>
        </TabsList>
      </Tabs>

      {inspirations.length === 0 ? (
        <EmptyState large icon={<Lightbulb className="h-10 w-10 text-muted-foreground/40" />}>
          <div className="space-y-2">
            <p>No inspirations yet.</p>
            <p className="text-xs">
              Make sure your LinkedIn session is synced on the{" "}
              <Link href="/linkedin" className="underline">
                LinkedIn page
              </Link>
              {" "}before you paste — the fetcher uses your logged-in cookies.
            </p>
          </div>
        </EmptyState>
      ) : (
        <div className="space-y-2">
          {inspirations.map((i) => (
            <Link
              key={i.id}
              href={`/inspirations/${i.id}`}
              className="flex items-start gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Lightbulb className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">
                    {i.source_author || <span className="text-muted-foreground italic">{shortUrl(i.url)}</span>}
                  </span>
                  <StatusBadge status={i.status} />
                </div>
                {i.source_text ? (
                  <p className="text-xs text-muted-foreground line-clamp-2">{i.source_text}</p>
                ) : i.status === "failed" && i.error ? (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {i.error}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground italic">Fetching...</p>
                )}
              </div>
              <span className="text-xs text-muted-foreground shrink-0 pt-1">{timeAgo(i.created_at)}</span>
            </Link>
          ))}
        </div>
      )}

      <Dialog open={showPaste} onOpenChange={setShowPaste}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Paste LinkedIn URLs</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>One URL per line</Label>
              <Textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={10}
                placeholder={`https://www.linkedin.com/posts/...\nhttps://www.linkedin.com/feed/update/...`}
                className="font-mono text-xs"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Each URL becomes one run on the Inspirations Processor agent. Eager polling drains the batch back-to-back.
              </p>
            </div>
            {pasteMsg && <p className="text-xs text-muted-foreground">{pasteMsg}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setShowPaste(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !pasteText.trim()}>
                {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Queue
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div className="text-xs text-muted-foreground border-t pt-3 flex items-center gap-1">
        <ExternalLink className="h-3 w-3" />
        Fetches use the LinkedIn session synced via the Chrome extension. See <Link href="/linkedin" className="underline">/linkedin</Link>.
      </div>
    </div>
  );
}
