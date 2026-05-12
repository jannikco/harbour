"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { BackLink } from "@/components/app/back-link";
import {
  ExternalLink,
  Copy,
  Check,
  Loader2,
  RotateCw,
  Trash2,
  AlertCircle,
  MessageSquare,
  Sparkles,
  Lightbulb,
  ListOrdered,
} from "lucide-react";
import { timeAgo } from "@/lib/time";
import { EmptyState } from "@/components/app/empty-state";

type Inspiration = {
  id: string;
  url: string;
  status: "queued" | "processing" | "done" | "failed";
  source_author: string | null;
  source_author_url: string | null;
  source_posted_at_text: string | null;
  source_text: string | null;
  source_image_urls: string[] | null;
  source_reactions: number | null;
  source_comments: number | null;
  analysis: string | null;
  post_draft: string | null;
  reply_draft: string | null;
  topic_ideas: string[] | null;
  run_id: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
};

function fmtNum(n: number | null): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function CopyButton({ text }: { text: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

export default function InspirationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  const [postEdit, setPostEdit] = useState<string | null>(null);
  const [replyEdit, setReplyEdit] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<"post" | "reply" | null>(null);

  const { data: insp = null, isLoading } = useQuery<Inspiration | null>({
    queryKey: ["inspiration", id],
    queryFn: async () => {
      const res = await fetch(`/api/inspirations/${id}`);
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 5000,
  });

  async function handleRetry() {
    setRetrying(true);
    try {
      const res = await fetch(`/api/inspirations/${id}/retry`, { method: "POST" });
      if (!res.ok) {
        alert("Retry failed");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["inspiration", id] });
      queryClient.invalidateQueries({ queryKey: ["inspirations"] });
    } finally {
      setRetrying(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this inspiration?")) return;
    const res = await fetch(`/api/inspirations/${id}`, { method: "DELETE" });
    if (!res.ok) {
      alert("Delete failed");
      return;
    }
    router.push("/inspirations");
  }

  async function saveField(field: "post_draft" | "reply_draft", value: string) {
    setSavingField(field === "post_draft" ? "post" : "reply");
    try {
      await fetch(`/api/inspirations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      queryClient.invalidateQueries({ queryKey: ["inspiration", id] });
      if (field === "post_draft") setPostEdit(null);
      if (field === "reply_draft") setReplyEdit(null);
    } finally {
      setSavingField(null);
    }
  }

  if (isLoading) return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;
  if (!insp) return <div className="text-sm text-muted-foreground py-12 text-center">Inspiration not found.</div>;

  const showWaiting = insp.status === "queued" || insp.status === "processing";

  return (
    <div className="space-y-6">
      <BackLink href="/inspirations" label="Inspirations" />

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight truncate">
            {insp.source_author || <span className="text-muted-foreground italic">Pending fetch</span>}
          </h1>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <a
              href={insp.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 underline truncate max-w-md"
            >
              <ExternalLink className="h-3 w-3 shrink-0" />
              <span className="truncate">{insp.url}</span>
            </a>
            {insp.source_posted_at_text && <span>· {insp.source_posted_at_text}</span>}
            <span>· added {timeAgo(insp.created_at)}</span>
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {(insp.status === "failed" || insp.status === "done") && (
            <Button variant="outline" size="sm" onClick={handleRetry} disabled={retrying}>
              {retrying ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RotateCw className="h-3.5 w-3.5 mr-1" />}
              Retry
            </Button>
          )}
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleDelete} title="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {insp.status === "failed" && insp.error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Failed</div>
            <div className="text-xs mt-1 opacity-90">{insp.error}</div>
          </div>
        </div>
      )}

      {showWaiting && (
        <div className="rounded-lg border bg-amber-500/5 border-amber-500/20 p-4 text-sm flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>
            {insp.status === "queued"
              ? "Queued — waiting for the Inspirations Processor agent to pick it up (next poll within ~60s)."
              : "Processing — fetching the post and generating drafts."}
          </span>
        </div>
      )}

      {/* Source */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Source post</h2>
        <div className="rounded-lg border p-4 bg-card space-y-3">
          {insp.source_text ? (
            <p className="text-sm whitespace-pre-wrap">{insp.source_text}</p>
          ) : (
            <EmptyState>Post body not yet fetched.</EmptyState>
          )}
          {insp.source_image_urls && insp.source_image_urls.length > 0 && (
            <div className="flex gap-2 overflow-x-auto">
              {insp.source_image_urls.map((u, i) => (
                <a key={i} href={u} target="_blank" rel="noreferrer" className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="" className="h-24 w-24 object-cover rounded border" />
                </a>
              ))}
            </div>
          )}
          {(insp.source_reactions !== null || insp.source_comments !== null) && (
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span>{fmtNum(insp.source_reactions)} reactions</span>
              <span>{fmtNum(insp.source_comments)} comments</span>
            </div>
          )}
        </div>
      </section>

      {/* Analysis */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5" /> Analysis
        </h2>
        {insp.analysis ? (
          <div className="rounded-lg border p-4 bg-card prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{insp.analysis}</ReactMarkdown>
          </div>
        ) : (
          <EmptyState>Pending.</EmptyState>
        )}
      </section>

      {/* Draft LinkedIn post */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
            <Lightbulb className="h-3.5 w-3.5" /> Draft LinkedIn post (in your voice)
          </h2>
          {insp.post_draft && (
            <div className="flex gap-1.5">
              <CopyButton text={insp.post_draft} />
              {postEdit === null ? (
                <Button variant="outline" size="sm" onClick={() => setPostEdit(insp.post_draft || "")}>
                  Edit
                </Button>
              ) : (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setPostEdit(null)}>Cancel</Button>
                  <Button size="sm" onClick={() => saveField("post_draft", postEdit)} disabled={savingField === "post"}>
                    {savingField === "post" && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                    Save
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
        {insp.post_draft ? (
          postEdit !== null ? (
            <Textarea value={postEdit} onChange={(e) => setPostEdit(e.target.value)} rows={10} className="font-mono text-sm" />
          ) : (
            <div className="rounded-lg border p-4 bg-card prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{insp.post_draft}</ReactMarkdown>
            </div>
          )
        ) : (
          <EmptyState>Pending.</EmptyState>
        )}
      </section>

      {/* Reply / comment draft */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
            <MessageSquare className="h-3.5 w-3.5" /> Reply on the original
          </h2>
          {insp.reply_draft && (
            <div className="flex gap-1.5">
              <CopyButton text={insp.reply_draft} />
              {replyEdit === null ? (
                <Button variant="outline" size="sm" onClick={() => setReplyEdit(insp.reply_draft || "")}>
                  Edit
                </Button>
              ) : (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setReplyEdit(null)}>Cancel</Button>
                  <Button size="sm" onClick={() => saveField("reply_draft", replyEdit)} disabled={savingField === "reply"}>
                    {savingField === "reply" && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                    Save
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
        {insp.reply_draft ? (
          replyEdit !== null ? (
            <Textarea value={replyEdit} onChange={(e) => setReplyEdit(e.target.value)} rows={5} className="font-mono text-sm" />
          ) : (
            <div className="rounded-lg border p-4 bg-card text-sm whitespace-pre-wrap">{insp.reply_draft}</div>
          )
        ) : (
          <EmptyState>Pending.</EmptyState>
        )}
      </section>

      {/* Topic ideas */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <ListOrdered className="h-3.5 w-3.5" /> Topic ideas
        </h2>
        {insp.topic_ideas && insp.topic_ideas.length > 0 ? (
          <ul className="rounded-lg border p-4 bg-card text-sm space-y-1.5 list-disc pl-6">
            {insp.topic_ideas.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        ) : (
          <EmptyState>Pending.</EmptyState>
        )}
      </section>

      <Badge variant="outline" className="text-xs">
        Status: {insp.status} {insp.run_id && <span className="ml-1 opacity-60">· run {insp.run_id.slice(0, 8)}</span>}
      </Badge>
    </div>
  );
}
