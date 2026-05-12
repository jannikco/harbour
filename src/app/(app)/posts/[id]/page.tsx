"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ExternalLink, ArrowDown, ArrowUp, MessageSquare } from "lucide-react";

type Resp = {
  post: {
    id: number;
    linkedin_post_id: string;
    post_url: string;
    posted_at: number | null;
    content_excerpt: string | null;
    comment_count: number;
    replied_count: number;
    ignored_count: number;
    last_scraped_at: number | null;
  };
  comments: Array<{
    interaction_id: number;
    commenter: {
      id: number | null;
      name: string | null;
      headline: string | null;
      company: string | null;
      linkedin_url: string | null;
      tags: string[];
      status: string;
      engagement?: {
        freebie_sent: boolean;
        paid_offer_sent: boolean;
        dm_count: number;
        pending_drafts: number;
        approved_drafts: number;
        is_customer: boolean;
      };
    };
    comment_text: string;
    comment_time: number | null;
    our_reply: { text: string | null; time: number | null } | null;
  }>;
};

function fmtRel(ts: number | null): string {
  if (!ts) return "—";
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

export default function PostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Resp | null>(null);
  const [tab, setTab] = useState<"all" | "replied" | "ignored">("all");
  const [notFound, setNotFound] = useState(false);

  async function load() {
    const r = await fetch(`/api/posts/${id}`);
    if (r.status === 404) {
      setNotFound(true);
      return;
    }
    setData(await r.json());
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (notFound) {
    return (
      <div className="p-6">
        <Link href="/posts" className="text-sm text-muted-foreground hover:text-foreground">
          ← back to posts
        </Link>
        <p className="mt-6 text-sm">Post not found.</p>
      </div>
    );
  }
  if (!data) return <div className="p-6 text-sm text-muted-foreground">loading…</div>;

  const filtered = data.comments.filter((c) =>
    tab === "all" ? true : tab === "replied" ? !!c.our_reply : !c.our_reply
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <Link
        href="/posts"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Posts
      </Link>

      <header className="rounded-lg border bg-card p-5">
        <div className="flex flex-wrap items-start gap-3">
          <MessageSquare className="mt-1 h-5 w-5 text-muted-foreground" />
          <div className="flex-1">
            <p className="text-sm leading-relaxed">{data.post.content_excerpt || "(no excerpt)"}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>posted {fmtRel(data.post.posted_at)}</span>
              <span>· scraped {fmtRel(data.post.last_scraped_at)}</span>
              <span>· {data.post.comment_count} comments</span>
              <span className="text-emerald-600">{data.post.replied_count} replied</span>
              <span className="text-amber-600">{data.post.ignored_count} ignored</span>
            </div>
          </div>
          <a
            href={data.post.post_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent"
          >
            <ExternalLink className="h-4 w-4" /> Open on LinkedIn
          </a>
        </div>
      </header>

      <div className="flex gap-1 border-b">
        {(["all", "replied", "ignored"] as const).map((t) => (
          <Button
            key={t}
            variant="ghost"
            size="sm"
            onClick={() => setTab(t)}
            className={`rounded-none border-b-2 ${
              tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
            }`}
          >
            {t === "all" ? `All (${data.comments.length})` :
             t === "replied" ? `Replied (${data.comments.filter((c) => c.our_reply).length})` :
             `Ignored (${data.comments.filter((c) => !c.our_reply).length})`}
          </Button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            No comments in this filter.
          </div>
        ) : (
          filtered.map((c) => (
            <div key={c.interaction_id} className="rounded-md border bg-card p-3">
              <div className="flex flex-wrap items-start gap-2">
                <ArrowDown className="mt-1 h-3.5 w-3.5 text-blue-600" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2 text-sm">
                    {c.commenter.id ? (
                      <Link
                        href={`/contacts/${c.commenter.id}`}
                        className="font-medium text-primary hover:underline"
                        title="Open this contact's CRM card"
                      >
                        {c.commenter.name || "(unknown)"}
                      </Link>
                    ) : (
                      <span className="font-medium">{c.commenter.name || "(unknown)"}</span>
                    )}
                    {c.commenter.linkedin_url && (
                      <a
                        href={c.commenter.linkedin_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:underline"
                        title="Open LinkedIn profile in new tab"
                      >
                        <ExternalLink className="h-3 w-3" /> LinkedIn
                      </a>
                    )}
                    {c.commenter.headline && (
                      <span className="text-xs text-muted-foreground">{c.commenter.headline}</span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {fmtRel(c.comment_time)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm">{c.comment_text}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {c.commenter.tags.map((t) => (
                      <Badge key={t} variant="secondary" className="text-[10px]">
                        {t}
                      </Badge>
                    ))}
                    {c.our_reply ? (
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300 text-[10px]">
                        Replied
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300 text-[10px]">
                        Ignored
                      </Badge>
                    )}
                    {c.commenter.engagement?.is_customer && (
                      <Badge variant="outline" className="bg-violet-500/15 text-violet-700 border-violet-500/30 dark:text-violet-300 text-[10px]">
                        💰 customer
                      </Badge>
                    )}
                    {c.commenter.engagement?.freebie_sent && (
                      <Badge variant="outline" className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300 text-[10px]">
                        ✓ freebie sent
                      </Badge>
                    )}
                    {c.commenter.engagement?.paid_offer_sent && (
                      <Badge variant="outline" className="bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-300 text-[10px]">
                        offer sent
                      </Badge>
                    )}
                    {(c.commenter.engagement?.dm_count ?? 0) > 0 && (
                      <Badge variant="outline" className="text-[10px]">
                        {c.commenter.engagement!.dm_count} DM{c.commenter.engagement!.dm_count === 1 ? "" : "s"}
                      </Badge>
                    )}
                    {(c.commenter.engagement?.pending_drafts ?? 0) > 0 && (
                      <Badge variant="outline" className="bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300 text-[10px]">
                        📝 {c.commenter.engagement!.pending_drafts} draft pending
                      </Badge>
                    )}
                    {(c.commenter.engagement?.approved_drafts ?? 0) > 0 && (
                      <Badge variant="outline" className="bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-300 text-[10px]">
                        ✓ {c.commenter.engagement!.approved_drafts} approved
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {c.our_reply && (
                <div className="ml-6 mt-2 rounded-md border-l-2 border-emerald-500/40 bg-muted/30 p-2">
                  <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
                    <ArrowUp className="h-3 w-3 text-emerald-600" />
                    <span>your reply · {fmtRel(c.our_reply.time)}</span>
                  </div>
                  <p className="mt-0.5 text-sm">{c.our_reply.text}</p>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
