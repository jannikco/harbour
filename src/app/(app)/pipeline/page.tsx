"use client";

import { useEffect, useState } from "react";
import { PipelineColumn } from "@/components/app/pipeline-column";
import { STATUSES, type Status, type ContactListItem } from "@/lib/contacts-types";

type Buckets = Record<Status, ContactListItem[]>;

const EMPTY: Buckets = {
  new: [],
  engaged: [],
  qualified: [],
  customer: [],
  cold: [],
  "do-not-contact": [],
};

export default function PipelinePage() {
  const [buckets, setBuckets] = useState<Buckets>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  async function loadAll() {
    setLoading(true);
    const next: Buckets = { ...EMPTY };
    let total = 0;
    await Promise.all(
      STATUSES.map(async (s) => {
        const r = await fetch(`/api/contacts?status=${s}&limit=500`);
        const j = await r.json();
        const list = (j.contacts || []) as ContactListItem[];
        next[s] = list;
        total += j.total ?? list.length;
      })
    );
    setBuckets(next);
    setTotal(total);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function onMove(contactId: number, to: Status) {
    // Optimistic: find + move
    const fromStatus = STATUSES.find((s) =>
      buckets[s].some((c) => c.id === contactId)
    );
    if (!fromStatus) return;
    const moving = buckets[fromStatus].find((c) => c.id === contactId);
    if (!moving) return;

    const next: Buckets = { ...buckets };
    next[fromStatus] = next[fromStatus].filter((c) => c.id !== contactId);
    next[to] = [{ ...moving, status: to }, ...next[to]];
    setBuckets(next);

    try {
      const r = await fetch(`/api/contacts/${contactId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: to }),
      });
      if (!r.ok) {
        // rollback
        await loadAll();
      }
    } catch {
      await loadAll();
    }
  }

  return (
    <div className="mx-auto max-w-[1800px] space-y-4 p-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            Contacts by funnel stage. Use the menu on each card to move it.
            {total > 0 && <> · <span className="ml-1">{total} total</span></>}
          </p>
        </div>
      </header>

      {loading ? (
        <div className="text-sm text-muted-foreground">loading…</div>
      ) : (
        <div className="flex h-[calc(100vh-12rem)] gap-3 overflow-x-auto pb-3">
          {STATUSES.map((s) => (
            <PipelineColumn key={s} status={s} contacts={buckets[s]} onMove={onMove} />
          ))}
        </div>
      )}
    </div>
  );
}
