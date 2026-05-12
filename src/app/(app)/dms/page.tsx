"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, RefreshCw, MessageCircle, ArrowDown, ArrowUp, ExternalLink, Check, X, Sparkles } from "lucide-react";

type DmThread = {
  contact_id: number;
  contact_name: string | null;
  contact_headline: string | null;
  contact_company: string | null;
  contact_linkedin_url: string | null;
  contact_status: string;
  contact_tags: string[];
  message_count: number;
  in_count: number;
  out_count: number;
  last_message_at: number;
  last_message_preview: string;
  last_direction: "in" | "out";
  unreplied: boolean;
  pending_drafts: number;
  approved_drafts: number;
  needs_human: number;
};

type Draft = {
  id: number;
  contact_db_id: number;
  text: string;
  draft_status: string;
  language: string | null;
  classification: string | null;
  created_at: number;
};

type Thread = {
  contact: { id: number; name: string | null; headline: string | null; linkedin_url: string | null; linkedin_thread_url: string | null; status: string; tags: string[] };
  messages: Array<{ id: number; direction: "in" | "out"; text: string; created_at: number; sent_at: number | null }>;
  drafts: Draft[];
  originating_comment: { excerpt: string; post_url: string; created_at: number } | null;
};

function fmtRel(ts: number): string {
  if (!ts) return "—";
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d`;
  return new Date(ts * 1000).toLocaleDateString();
}

type SendStatus = {
  maxDmsPerDay: number;
  sentToday: number;
  approvedQueue: number;
  spreadHours: number;
};

export default function DmsPage() {
  const [threads, setThreads] = useState<DmThread[]>([]);
  const [filter, setFilter] = useState<"all" | "unreplied" | "needs-action" | "queue">("all");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [scraping, setScraping] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [sendStatus, setSendStatus] = useState<SendStatus | null>(null);

  async function load() {
    setBusy(true);
    try {
      const r = await fetch(`/api/dms?filter=${filter === "unreplied" ? "unreplied" : "all"}&limit=200`);
      const j = await r.json();
      let list = (j.threads || []) as DmThread[];
      if (filter === "needs-action") {
        list = list.filter((t) => t.pending_drafts > 0 || t.needs_human > 0 || t.unreplied);
      } else if (filter === "queue") {
        list = list.filter((t) => t.approved_drafts > 0);
      }
      setThreads(list);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [filter]);

  useEffect(() => {
    let cancelled = false;
    async function loadSendStatus() {
      try {
        const [limitsRes, threadsRes] = await Promise.all([
          fetch("/api/linkedin/limits"),
          fetch("/api/dms?limit=200"),
        ]);
        if (cancelled) return;
        const limitsJson = limitsRes.ok ? await limitsRes.json() : null;
        const threadsJson = threadsRes.ok ? await threadsRes.json() : { threads: [] };
        const approvedQueue = (threadsJson.threads || []).reduce(
          (acc: number, t: { approved_drafts?: number }) => acc + (t.approved_drafts || 0),
          0,
        );
        setSendStatus({
          maxDmsPerDay: limitsJson?.config?.maxDmsPerDay ?? 0,
          sentToday: limitsJson?.usage?.dms24h ?? 0,
          approvedQueue,
          spreadHours: limitsJson?.config?.spreadHours ?? 8,
        });
      } catch {
        // ignore
      }
    }
    loadSendStatus();
    const id = setInterval(loadSendStatus, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  async function openThread(id: number) {
    setSelected(id);
    setThread(null);
    const r = await fetch(`/api/dms/${id}`);
    if (r.ok) setThread(await r.json());
  }

  async function scrape() {
    setScraping(true);
    setMsg(null);
    try {
      const r = await fetch("/api/dms/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max: 20 }),
      });
      const j = await r.json();
      if (!r.ok && r.status !== 202 && r.status !== 409) setMsg(j.error || "scrape failed");
      else setMsg("Scrape started…");
      const tick = setInterval(async () => {
        const s = await fetch("/api/dms/scrape").then((r) => r.json());
        if (s.status === "done") {
          clearInterval(tick);
          setScraping(false);
          setMsg(`Done. inserted=${s.result?.messagesInserted ?? 0} contacts new=${s.result?.contactsUpserted ?? 0} matched=${s.result?.contactsMatched ?? 0}`);
          load();
        } else if (s.status === "error") {
          clearInterval(tick);
          setScraping(false);
          setMsg(`Error: ${s.error?.slice(0, 200)}`);
        } else if (s.status === "idle") { clearInterval(tick); setScraping(false); }
      }, 4000);
    } catch (err) { setScraping(false); setMsg(String(err)); }
  }

  return (
    <div className="w-full space-y-4 p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">DMs</h1>
          <p className="text-sm text-muted-foreground">
            Inbound + outbound LinkedIn DMs · {threads.length} threads
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["all", "unreplied", "needs-action", "queue"] as const).map((f) => {
            const queueCount = threads.filter((t) => t.approved_drafts > 0).length;
            const label = f === "needs-action" ? "Needs action" : f === "unreplied" ? "Unreplied" : f === "queue" ? `Queue${queueCount > 0 ? ` · ${queueCount}` : ""}` : "All";
            return (
              <Button
                key={f}
                variant={filter === f ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter(f)}
              >
                {label}
              </Button>
            );
          })}
          <Button onClick={scrape} disabled={scraping} className="gap-2">
            {scraping ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Scrape inbox
          </Button>
        </div>
      </header>

      {msg && <p className="rounded-md border bg-card p-3 text-xs text-muted-foreground">{msg}</p>}

      {sendStatus && (
        sendStatus.maxDmsPerDay <= 0 ? (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
            <strong className="font-semibold">Auto-send: OFF (kill switch).</strong>{" "}
            Approve drafts to queue; nothing ships until you raise the daily DM cap in{" "}
            <Link href="/linkedin" className="underline hover:no-underline">Settings → LinkedIn</Link>.
            {sendStatus.approvedQueue > 0 && (
              <> Currently {sendStatus.approvedQueue} draft{sendStatus.approvedQueue === 1 ? "" : "s"} waiting.</>
            )}
          </div>
        ) : (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
            <strong className="font-semibold">Auto-send: ON</strong> · {sendStatus.sentToday}/{sendStatus.maxDmsPerDay} sent today · {sendStatus.approvedQueue} approved in queue · spread over {sendStatus.spreadHours}h
          </div>
        )
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[440px_1fr]">
        <div className="rounded-lg border bg-card">
          {busy && threads.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">loading…</div>
          ) : threads.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No threads.</div>
          ) : (
            <ul className="max-h-[calc(100vh-200px)] overflow-y-auto">
              {threads.map((t) => (
                <li
                  key={t.contact_id}
                  onClick={() => openThread(t.contact_id)}
                  className={`cursor-pointer border-b p-3 last:border-b-0 hover:bg-accent/30 ${
                    selected === t.contact_id ? "bg-accent/40" : ""
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="truncate text-sm font-medium">{t.contact_name || `Contact #${t.contact_id}`}</div>
                    <div className="text-xs text-muted-foreground">{fmtRel(t.last_message_at)}</div>
                  </div>
                  {t.contact_headline && (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{t.contact_headline}</div>
                  )}
                  <div className="mt-1 flex items-baseline gap-1">
                    {t.last_direction === "in" ? <ArrowDown className="h-3 w-3 text-blue-600" /> : <ArrowUp className="h-3 w-3 text-emerald-600" />}
                    <span className="truncate text-xs text-muted-foreground">{t.last_message_preview}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {t.pending_drafts > 0 && (
                      <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300">
                        {t.pending_drafts} draft{t.pending_drafts === 1 ? "" : "s"} pending
                      </Badge>
                    )}
                    {t.approved_drafts > 0 && (
                      <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-300">
                        {t.approved_drafts} approved
                      </Badge>
                    )}
                    {t.needs_human > 0 && (
                      <Badge variant="outline" className="text-[10px] bg-rose-500/10 text-rose-700 border-rose-500/30 dark:text-rose-300">
                        needs you
                      </Badge>
                    )}
                    {t.pending_drafts === 0 && t.approved_drafts === 0 && t.needs_human === 0 && t.unreplied && (
                      <Badge variant="outline" className="text-[10px] bg-slate-500/10 text-slate-700 border-slate-500/30 dark:text-slate-300">
                        unreplied
                      </Badge>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {t.in_count} in · {t.out_count} out
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border bg-card">
          {!selected ? (
            <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
              <MessageCircle className="mr-2 h-4 w-4" /> Pick a thread on the left.
            </div>
          ) : !thread ? (
            <div className="p-8 text-sm text-muted-foreground">loading thread…</div>
          ) : (
            <div className="flex h-[calc(100vh-200px)] flex-col">
              <div className="border-b p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <Link href={`/contacts/${thread.contact.id}`} className="text-base font-medium hover:underline">
                    {thread.contact.name || `Contact #${thread.contact.id}`}
                  </Link>
                </div>
                {thread.contact.headline && (
                  <div className="mt-0.5 text-xs text-muted-foreground">{thread.contact.headline}</div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {thread.contact.tags.map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {thread.contact.linkedin_url && (
                    <a
                      href={thread.contact.linkedin_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs font-medium hover:bg-accent"
                      title="Open the contact's profile in LinkedIn"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Profile
                    </a>
                  )}
                  {thread.contact.linkedin_thread_url && (
                    <a
                      href={thread.contact.linkedin_thread_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#0A66C2]/40 bg-[#0A66C2]/10 px-2.5 text-xs font-medium text-[#0A66C2] hover:bg-[#0A66C2]/20"
                      title="Jump straight to this conversation in LinkedIn"
                    >
                      <MessageCircle className="h-3.5 w-3.5" /> Reply in LinkedIn
                    </a>
                  )}
                </div>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {/* Newest message at the top so the latest is visible without scrolling */}
                {[...thread.messages].reverse().map((m) => (
                  <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                      m.direction === "out" ? "bg-primary/10 text-foreground" : "bg-muted text-foreground"
                    }`}>
                      <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {m.direction === "in" ? "received " : "sent "}{fmtRel(m.created_at)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {/* Sticky draft composer (LinkedIn-style — pinned to the bottom) */}
              <div className="shrink-0 border-t-2 border-dashed bg-muted/30">
                {(() => {
                  const activeDrafts = thread.drafts.filter(
                    (d) => d.draft_status === "pending" || d.draft_status === "approved" || d.draft_status === "needs-human"
                  );
                  if (activeDrafts.length === 0) {
                    return (
                      <EmptyStateCard
                        thread={thread}
                        sendStatus={sendStatus}
                        onTriggered={() => openThread(thread.contact.id)}
                      />
                    );
                  }
                  const oc = thread.originating_comment;
                  return (
                    <>
                      {/* Provenance card — show ABOVE the draft(s) so the
                          user knows which post/comment triggered this lead */}
                      <div className="border-b bg-card px-4 py-2.5">
                        {oc ? (
                          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
                            <div className="flex items-start gap-2">
                              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                              <div className="min-w-0 flex-1 text-xs">
                                <div className="font-medium text-emerald-700 dark:text-emerald-300">Triggered by comment on LinkedIn post</div>
                                {oc.excerpt && (
                                  <div className="mt-0.5 truncate text-foreground/80">&ldquo;{oc.excerpt}&rdquo;</div>
                                )}
                                <div className="mt-1 text-[10px] text-muted-foreground">
                                  Commented {fmtRel(oc.created_at)} ·{" "}
                                  <a
                                    href={oc.post_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 underline hover:no-underline"
                                  >
                                    Open post in LinkedIn <ExternalLink className="h-3 w-3" />
                                  </a>
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                            <div className="flex items-start gap-2">
                              <span className="mt-0.5 shrink-0 text-amber-600">⚠</span>
                              <div className="min-w-0 flex-1 text-xs">
                                <div className="font-medium text-amber-700 dark:text-amber-300">No source comment found</div>
                                <div className="mt-0.5 text-foreground/80">
                                  Draft is based on DM context only — verify the lead-magnet matches what they actually asked for before approving.
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                      {activeDrafts.map((d) => (
                        <DraftCard
                          key={d.id}
                          draft={d}
                          onChange={() => openThread(thread.contact.id)}
                          threadUrl={thread.contact.linkedin_thread_url}
                          autoSendOn={!!sendStatus && sendStatus.maxDmsPerDay > 0}
                        />
                      ))}
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DraftCard({ draft, onChange, threadUrl, autoSendOn }: { draft: Draft; onChange: () => void; threadUrl?: string | null; autoSendOn: boolean }) {
  const [text, setText] = useState(draft.text);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function statusColor() {
    if (draft.draft_status === "approved") return "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-300";
    if (draft.draft_status === "needs-human") return "bg-rose-500/10 text-rose-700 border-rose-500/30 dark:text-rose-300";
    return "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300";
  }
  function statusLabel() {
    if (draft.draft_status === "approved") {
      return autoSendOn ? "Approved · shipping shortly" : "Approved · queued (auto-send OFF)";
    }
    if (draft.draft_status === "needs-human") return "Needs you";
    return "Draft pending";
  }

  async function save(newText: string) {
    setSaving(true);
    try {
      await fetch(`/api/dms/drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: newText }),
      });
      setSavedAt(Date.now());
    } finally { setSaving(false); }
  }

  function onTextChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    setText(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => save(v), 800);
  }

  async function approve() {
    await fetch(`/api/dms/drafts/${draft.id}/approve`, { method: "POST" });
    onChange();
  }
  async function reject() {
    if (!confirm("Reject this draft? It moves to the rejected bucket and won't ship.")) return;
    await fetch(`/api/dms/drafts/${draft.id}/reject`, { method: "POST" });
    onChange();
  }

  return (
    <div className="bg-card p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <Badge variant="outline" className={statusColor()}>
            {statusLabel()}
          </Badge>
          {draft.classification && (
            <Badge variant="secondary" className="text-[10px]">{draft.classification}</Badge>
          )}
          {draft.language && (
            <Badge variant="outline" className="text-[10px]">{draft.language}</Badge>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {saving ? "saving…" : savedAt && Date.now() - savedAt < 3000 ? "saved ✓" : `drafted ${fmtRel(draft.created_at)}`}
        </div>
      </div>
      {draft.draft_status === "needs-human" ? (
        <div className="rounded-md bg-rose-500/5 p-2 text-sm">
          Flagged for manual handling: {text || "(no reason given)"}
        </div>
      ) : (
        <Textarea
          value={text}
          onChange={onTextChange}
          rows={Math.min(8, Math.max(3, text.split("\n").length))}
          className="resize-none text-sm"
        />
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {draft.draft_status !== "approved" && draft.draft_status !== "needs-human" && (
          <Button size="sm" onClick={approve} className="gap-2">
            <Check className="h-3.5 w-3.5" /> Approve &amp; send
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={reject} className="gap-2 text-destructive hover:text-destructive">
          <X className="h-3.5 w-3.5" /> Reject
        </Button>
        {draft.draft_status === "approved" && threadUrl && (
          <a
            href={threadUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            <ExternalLink className="h-3 w-3" /> View thread in LinkedIn
          </a>
        )}
        <span className="ml-auto self-center text-right text-[10px] text-muted-foreground">
          {draft.draft_status === "approved"
            ? (autoSendOn
              ? "Auto-send ON · message ships within the next safe-send window."
              : "Auto-send OFF (kill switch). Raise the daily cap to ship.")
            : (autoSendOn
              ? "Approve → ships automatically. Reject → discarded."
              : "Approve marks ready. Nothing ships until the daily cap is raised.")}
        </span>
      </div>
    </div>
  );
}

// Hardcoded — matches src/app/api/dms/drafts/[id]/approve/route.ts and the
// registered "DM Replies Drafter" job in harbour.db. If you rename / replace
// the drafter job, update both call-sites.
const DRAFTER_JOB_ID = "68831165-20c1-4011-b347-91fc724ec27b";

function EmptyStateCard({
  thread,
  sendStatus,
  onTriggered,
}: {
  thread: Thread;
  sendStatus: SendStatus | null;
  onTriggered: () => void;
}) {
  const [triggering, setTriggering] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const lastMsg = thread.messages.length > 0
    ? thread.messages[thread.messages.length - 1]
    : null;
  const daysDormant = lastMsg
    ? Math.floor((Date.now() / 1000 - lastMsg.created_at) / 86400)
    : null;
  const dailyCap = sendStatus?.maxDmsPerDay ?? 0;
  const dailyRemaining = Math.max(0, dailyCap - (sendStatus?.sentToday ?? 0));
  const dormantEnough = (daysDormant ?? 0) >= 14;
  const hasCapacity = dailyRemaining > 0;
  const canReEngage = dormantEnough && hasCapacity;

  async function triggerReEngagement() {
    setTriggering(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/jobs/${DRAFTER_JOB_ID}/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instructions: `Mode C re-engagement focused ONLY on contact_db_id=${thread.contact.id} (${thread.contact.name ?? "unknown"}). Ignore other contacts this run. Override the 14-day cadence if needed — this was a user-triggered request.`,
        }),
      });
      if (!r.ok) {
        const body = await r.text();
        setMsg(`Trigger failed: ${body.slice(0, 200)}`);
      } else {
        setMsg("Drafter triggered — refresh in ~30-60s to see the draft.");
        setTimeout(onTriggered, 30_000);
      }
    } catch (err) {
      setMsg(`Trigger error: ${String(err).slice(0, 200)}`);
    } finally {
      setTriggering(false);
    }
  }

  return (
    <div className="space-y-2 p-3 text-xs">
      <div className="text-muted-foreground">
        Nothing pending.{" "}
        {daysDormant != null && (
          <>Last contact {daysDormant === 0 ? "today" : `${daysDormant}d ago`}.{" "}</>
        )}
        {sendStatus ? (
          <>Credits today: {dailyRemaining}/{dailyCap} remaining.</>
        ) : (
          <>Loading limits…</>
        )}
      </div>
      {canReEngage && (
        <Button size="sm" onClick={triggerReEngagement} disabled={triggering} className="gap-2">
          {triggering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {triggering ? "Drafting…" : `Suggest re-engagement for ${thread.contact.name ?? "this contact"}`}
        </Button>
      )}
      {!canReEngage && !hasCapacity && (
        <div className="text-muted-foreground">
          No send capacity today. Raise the daily cap in{" "}
          <Link href="/linkedin" className="underline hover:no-underline">Settings → LinkedIn</Link>{" "}
          to enable re-engagement.
        </div>
      )}
      {!canReEngage && hasCapacity && !dormantEnough && (
        <div className="text-muted-foreground">
          Too soon for re-engagement — need 14+ days dormant (currently {daysDormant ?? 0}d).
        </div>
      )}
      {msg && <div className="text-muted-foreground">{msg}</div>}
    </div>
  );
}
