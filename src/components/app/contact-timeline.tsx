"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import type { Interaction } from "@/lib/contacts-types";

function fmtAbsolute(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

function typeColor(type: string): string {
  switch (type) {
    case "dm":
      return "bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-blue-300";
    case "comment":
      return "bg-violet-500/10 text-violet-700 border-violet-500/20 dark:text-violet-300";
    case "reply":
      return "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300";
    case "email":
      return "bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300";
    default:
      return "bg-slate-500/10 text-slate-700 border-slate-500/20 dark:text-slate-300";
  }
}

function draftStatusColor(s: string): string {
  switch (s) {
    case "pending":
      return "bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300";
    case "approved":
      return "bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-blue-300";
    case "sent":
      return "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300";
    case "rejected":
      return "bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-300";
    default:
      return "bg-slate-500/10 text-slate-700 border-slate-500/20 dark:text-slate-300";
  }
}

export function ContactTimeline({ interactions }: { interactions: Interaction[] }) {
  if (interactions.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        No interactions yet. Drafts from agents and scraped messages will appear here.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {interactions.map((it) => (
        <TimelineRow key={it.id} interaction={it} />
      ))}
    </div>
  );
}

function TimelineRow({ interaction }: { interaction: Interaction }) {
  const [expanded, setExpanded] = useState(false);
  const hasDraft = !!interaction.draft_path;

  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-start gap-3 p-3">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
          {interaction.direction === "in" ? (
            <ArrowDown className="h-3.5 w-3.5 text-blue-600" />
          ) : (
            <ArrowUp className="h-3.5 w-3.5 text-emerald-600" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline" className={typeColor(interaction.type)}>
              {interaction.type}
            </Badge>
            <span className="text-muted-foreground">via {interaction.channel}</span>
            {interaction.language && (
              <Badge variant="outline" className="text-[10px]">
                {interaction.language}
              </Badge>
            )}
            {interaction.draft_status && (
              <Badge variant="outline" className={draftStatusColor(interaction.draft_status)}>
                {interaction.draft_status}
              </Badge>
            )}
            <span className="ml-auto text-muted-foreground">{fmtAbsolute(interaction.created_at)}</span>
          </div>
          {interaction.content_excerpt && (
            <p className="mt-1 line-clamp-3 text-sm">{interaction.content_excerpt}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {interaction.post_url && (
              <a
                href={interaction.post_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> open post
              </a>
            )}
            {hasDraft && (
              <button
                type="button"
                className="inline-flex items-center gap-1 hover:text-foreground"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                draft path
              </button>
            )}
          </div>
          {expanded && hasDraft && (
            <pre className="mt-2 rounded-md bg-muted p-2 text-xs">{interaction.draft_path}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
