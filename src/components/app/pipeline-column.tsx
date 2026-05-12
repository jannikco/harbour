"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import {
  STATUSES,
  STATUS_BADGE_CLASS,
  STATUS_LABELS,
  type Status,
  type ContactListItem,
} from "@/lib/contacts-types";

function fmtRelative(ts: number | null): string {
  if (!ts) return "no activity";
  const diff = Date.now() / 1000 - ts;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

export function PipelineColumn({
  status,
  contacts,
  onMove,
}: {
  status: Status;
  contacts: ContactListItem[];
  onMove: (contactId: number, to: Status) => void;
}) {
  return (
    <div className="flex h-full min-w-[280px] max-w-[320px] flex-col rounded-lg border bg-muted/30">
      <div className="flex items-center justify-between border-b bg-card px-3 py-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={STATUS_BADGE_CLASS[status]}>
            {STATUS_LABELS[status]}
          </Badge>
          <span className="text-xs text-muted-foreground">{contacts.length}</span>
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {contacts.length === 0 && (
          <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
            empty
          </div>
        )}
        {contacts.map((c) => (
          <div key={c.id} className="rounded-md border bg-card p-3 hover:bg-accent/30">
            <div className="flex items-start gap-2">
              <Link href={`/contacts/${c.id}`} className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {c.name || c.linkedin_url || `Contact #${c.id}`}
                </div>
                {c.headline && (
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">{c.headline}</div>
                )}
                {c.company && (
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">{c.company}</div>
                )}
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {STATUSES.filter((s) => s !== status).map((s) => (
                    <DropdownMenuItem key={s} onClick={() => onMove(c.id, s)}>
                      Move to {STATUS_LABELS[s]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {c.tags.slice(0, 3).map((t) => (
                <Badge key={t} variant="secondary" className="text-[10px]">
                  {t}
                </Badge>
              ))}
              {c.tags.length > 3 && (
                <Badge variant="secondary" className="text-[10px]">
                  +{c.tags.length - 3}
                </Badge>
              )}
              <span className="ml-auto text-[10px] text-muted-foreground">
                {fmtRelative(c.last_interaction_at)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
