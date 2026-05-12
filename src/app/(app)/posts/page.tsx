"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, RefreshCw, MessageSquare, ExternalLink } from "lucide-react";

type Post = {
  id: number;
  linkedin_post_id: string;
  post_url: string;
  posted_at: number | null;
  content_excerpt: string | null;
  comment_count: number;
  replied_count: number;
  ignored_count: number;
  reaction_count: number;
  last_scraped_at: number | null;
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

export default function PostsPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [discoverBusy, setDiscoverBusy] = useState(false);
  const [discoverMsg, setDiscoverMsg] = useState<string | null>(null);
  const [scraping, setScraping] = useState<Set<number>>(new Set());
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/posts");
      const j = await r.json();
      setPosts(j.posts || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // poll every 10s in case scraper updates counts
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  async function runDiscovery() {
    setDiscoverBusy(true);
    setDiscoverMsg(null);
    try {
      const r = await fetch("/api/posts/scrape-discovery", { method: "POST" });
      const j = await r.json();
      if (!r.ok) {
        setDiscoverMsg(j.error || "Discovery failed");
      } else {
        setDiscoverMsg(`Discovered ${j.upserted ?? 0} posts`);
        await load();
      }
    } finally {
      setDiscoverBusy(false);
    }
  }

  async function scrapeComments(post: Post) {
    if (scraping.has(post.id)) return;
    setScraping((s) => new Set([...s, post.id]));
    try {
      const r = await fetch(`/api/posts/${post.id}/scrape-comments`, { method: "POST" });
      const j = await r.json();
      if (!r.ok && r.status !== 202 && r.status !== 409) {
        setDiscoverMsg(j.error || "Scrape failed");
      }
    } finally {
      // Poll job status until done, then refresh
      const tick = setInterval(async () => {
        const s = await fetch(`/api/posts/${post.id}/scrape-comments`).then((r) => r.json());
        if (s.status === "done" || s.status === "error" || s.status === "idle") {
          clearInterval(tick);
          setScraping((set) => {
            const next = new Set(set);
            next.delete(post.id);
            return next;
          });
          load();
          if (s.status === "error") {
            setDiscoverMsg(`Scrape error: ${s.error?.slice(0, 200)}`);
          }
        }
      }, 4000);
    }
  }

  async function runEnrich() {
    setEnrichBusy(true);
    setEnrichMsg(null);
    try {
      const r = await fetch("/api/enrich/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch: 20 }),
      });
      const j = await r.json();
      if (!r.ok && r.status !== 202) {
        setEnrichMsg(j.error || "Enrich failed");
      } else if (j.status === "no-targets") {
        setEnrichMsg("No targets — all contacts already enriched or have no LinkedIn URL.");
      } else {
        setEnrichMsg(`Enriching ${j.picked ?? 20} profiles in background (~${Math.round((j.picked ?? 20) * 11 / 60)} min). Refresh /contacts to see results.`);
      }
    } finally {
      setEnrichBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Posts</h1>
          <p className="text-sm text-muted-foreground">
            Your recent LinkedIn posts + per-post comment stats. {posts.length} tracked.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={runDiscovery} disabled={discoverBusy} variant="outline" className="gap-2">
            {discoverBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Discover posts
          </Button>
          <Button onClick={runEnrich} disabled={enrichBusy} variant="outline" className="gap-2">
            {enrichBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Enrich 20 profiles
          </Button>
        </div>
      </header>

      {(discoverMsg || enrichMsg) && (
        <p className="rounded-md border bg-card p-3 text-xs text-muted-foreground">
          {discoverMsg && <span>{discoverMsg}</span>}
          {discoverMsg && enrichMsg && <span> · </span>}
          {enrichMsg && <span>{enrichMsg}</span>}
        </p>
      )}

      {loading && posts.length === 0 ? (
        <div className="text-sm text-muted-foreground">loading…</div>
      ) : posts.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          No posts tracked yet. Click <strong>Discover posts</strong> to pull your last 14 days from LinkedIn.
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Posted</TableHead>
                <TableHead>Excerpt</TableHead>
                <TableHead className="text-right">Comments</TableHead>
                <TableHead className="text-right">Replied</TableHead>
                <TableHead className="text-right">Ignored</TableHead>
                <TableHead className="text-right">Last scraped</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {posts.map((p) => {
                const pct = p.comment_count > 0 ? Math.round((p.replied_count / p.comment_count) * 100) : 0;
                return (
                  <TableRow key={p.id}>
                    <TableCell className="text-xs text-muted-foreground">{fmtRel(p.posted_at)}</TableCell>
                    <TableCell className="max-w-[360px]">
                      <Link href={`/posts/${p.id}`} className="block truncate text-sm hover:underline">
                        {p.content_excerpt?.slice(0, 90) || "(no excerpt)"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right text-sm">{p.comment_count}</TableCell>
                    <TableCell className="text-right text-sm">
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300">
                        {p.replied_count} {pct > 0 && <span className="ml-1 opacity-70">({pct}%)</span>}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300">
                        {p.ignored_count}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{fmtRel(p.last_scraped_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <a
                          href={p.post_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                          title="Open on LinkedIn"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1"
                          disabled={scraping.has(p.id)}
                          onClick={() => scrapeComments(p)}
                          title="Scrape comments"
                        >
                          {scraping.has(p.id) ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <MessageSquare className="h-3.5 w-3.5" />
                          )}
                          Scrape
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
