"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  STATUS_BADGE_CLASS,
  STATUS_LABELS,
  type ContactListItem,
} from "@/lib/contacts-types";

function fmtRelative(ts: number | null): string {
  if (!ts) return "—";
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

export function ContactTable({ contacts }: { contacts: ContactListItem[] }) {
  if (contacts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
        No contacts yet. Click <strong>Add contact</strong> to add one manually,
        or wait for the LinkedIn scrapers (next session) to populate this list.
      </div>
    );
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[250px]">Name</TableHead>
            <TableHead>Headline</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Tags</TableHead>
            <TableHead className="text-right">Last interaction</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.map((c) => (
            <TableRow key={c.id} className="cursor-pointer">
              <TableCell className="font-medium">
                <Link href={`/contacts/${c.id}`} className="block hover:underline">
                  {c.name || c.linkedin_url || c.email || `Contact #${c.id}`}
                </Link>
              </TableCell>
              <TableCell className="max-w-[280px] truncate text-sm text-muted-foreground">
                <Link href={`/contacts/${c.id}`} className="block">
                  {c.headline || "—"}
                </Link>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                <Link href={`/contacts/${c.id}`} className="block">
                  {c.company || "—"}
                </Link>
              </TableCell>
              <TableCell>
                <Link href={`/contacts/${c.id}`} className="block">
                  <Badge variant="outline" className={STATUS_BADGE_CLASS[c.status]}>
                    {STATUS_LABELS[c.status]}
                  </Badge>
                </Link>
              </TableCell>
              <TableCell>
                <Link href={`/contacts/${c.id}`} className="flex flex-wrap gap-1">
                  {c.tags.slice(0, 4).map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px]">
                      {t}
                    </Badge>
                  ))}
                  {c.tags.length > 4 && (
                    <Badge variant="secondary" className="text-[10px]">
                      +{c.tags.length - 4}
                    </Badge>
                  )}
                </Link>
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">
                <Link href={`/contacts/${c.id}`} className="block">
                  {fmtRelative(c.last_interaction_at)}
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
