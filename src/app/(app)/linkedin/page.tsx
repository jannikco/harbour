"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  Unplug,
  RotateCw,
  Save,
  Gauge,
  RefreshCw,
  Puzzle,
  Copy,
  KeyRound,
  Trash2,
  Download,
} from "lucide-react";
import { LinkedInIcon } from "@/components/app/linkedin-icon";

type StatusResp =
  | { status: "disconnected" }
  | { status: "running"; startedAt: number }
  | { status: "connected"; savedAt: number; sizeBytes: number }
  | { status: "error"; error?: string; exitCode?: number };

type VerifyResp = {
  ok: boolean;
  name?: string | null;
  url?: string | null;
  error?: string;
};

type LimitsConfig = {
  maxDmsPerDay: number;
  maxCommentsNonContactPerDay: number;
  maxCommentsContactPerDay: number;
  spreadHours: number;
  minSecondsBetweenActions: number;
  dmRewriteVariations: number;
  maxWritesPerHour: number;
  activeHoursStart: number;
  activeHoursEnd: number;
  jitterMinSeconds: number;
  jitterMaxSeconds: number;
  burstSize: number;
  burstBreakMinSeconds: number;
  burstBreakMaxSeconds: number;
  cronJitterMaxSeconds: number;
  useExtensionForSend: boolean;
  updatedAt: number;
};

type LimitsUsage = {
  dms24h: number;
  commentsNonContact24h: number;
  commentsContact24h: number;
  lastActionAt: number | null;
};

type LimitsResp = {
  config: LimitsConfig;
  usage: LimitsUsage;
  connectionsSyncedAt: number | null;
};

function formatRelative(ts: number): string {
  const diffMs = Date.now() - ts;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.floor(hr / 24)} days ago`;
}

export default function LinkedInConnectPage() {
  const [state, setState] = useState<StatusResp>({ status: "disconnected" });
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResp | null>(null);
  const [busy, setBusy] = useState(false);

  const [limits, setLimits] = useState<LimitsResp | null>(null);
  const [draft, setDraft] = useState<LimitsConfig | null>(null);
  const [savingLimits, setSavingLimits] = useState(false);
  const [limitsMsg, setLimitsMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  async function refresh() {
    try {
      const r = await fetch("/api/linkedin/connect");
      const j = (await r.json()) as StatusResp;
      setState(j);
    } catch {
      // ignore transient errors
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (state.status !== "running") return;
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [state.status]);

  async function connect() {
    setBusy(true);
    setVerifyResult(null);
    await fetch("/api/linkedin/connect", { method: "POST" });
    await refresh();
    setBusy(false);
  }

  async function cancel() {
    setBusy(true);
    await fetch("/api/linkedin/connect", { method: "DELETE" });
    await refresh();
    setBusy(false);
  }

  async function disconnect() {
    if (!confirm("Remove the saved LinkedIn session? You'll need to log in again.")) return;
    setBusy(true);
    await fetch("/api/linkedin/connect", { method: "DELETE" });
    await refresh();
    setBusy(false);
  }

  async function verify() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const r = await fetch("/api/linkedin/verify", { method: "POST" });
      const j = (await r.json()) as VerifyResp;
      setVerifyResult(j);
    } finally {
      setVerifying(false);
    }
  }

  async function loadLimits() {
    try {
      const r = await fetch("/api/linkedin/limits");
      const j = (await r.json()) as LimitsResp;
      setLimits(j);
      setDraft(j.config);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    loadLimits();
  }, []);

  function patchDraft(key: keyof LimitsConfig, value: number) {
    if (!draft) return;
    setDraft({ ...draft, [key]: Number.isFinite(value) ? value : 0 });
  }

  async function saveLimits() {
    if (!draft) return;
    setSavingLimits(true);
    setLimitsMsg(null);
    try {
      const r = await fetch("/api/linkedin/limits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const j = await r.json();
      if (!r.ok) {
        setLimitsMsg(j.error || "Save failed");
      } else {
        setLimitsMsg("Saved.");
        await loadLimits();
        setTimeout(() => setLimitsMsg(null), 2500);
      }
    } finally {
      setSavingLimits(false);
    }
  }

  async function syncConnections() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await fetch("/api/linkedin/sync-connections", { method: "POST" });
      const j = await r.json();
      setSyncMsg(j.message || (r.ok ? "Sync triggered." : "Sync failed."));
    } catch (err) {
      setSyncMsg(String(err));
    } finally {
      setSyncing(false);
    }
  }

  const dirty =
    draft && limits
      ? JSON.stringify(draft) !== JSON.stringify(limits.config)
      : false;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <header className="flex items-center gap-3">
        <LinkedInIcon className="h-7 w-7 text-[#0A66C2]" />
        <div>
          <h1 className="text-2xl font-semibold">LinkedIn connector</h1>
          <p className="text-sm text-muted-foreground">
            Cookie-based session used by the Playwright publishing & scraping
            workflows. Stored at <code>~/.harbour/state/linkedin-storage.json</code>.
          </p>
        </div>
      </header>

      <section className="rounded-lg border bg-card p-5">
        <div className="flex items-start gap-3">
          {state.status === "connected" && (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          )}
          {state.status === "running" && (
            <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary" />
          )}
          {state.status === "error" && (
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          )}
          {state.status === "disconnected" && (
            <Unplug className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          )}

          <div className="flex-1 space-y-1">
            {state.status === "connected" && (
              <>
                <div className="text-sm font-medium">Connected</div>
                <div className="text-xs text-muted-foreground">
                  Session captured {formatRelative(state.savedAt)} ·{" "}
                  {Math.round(state.sizeBytes / 1024)} KB
                </div>
              </>
            )}
            {state.status === "running" && (
              <>
                <div className="text-sm font-medium">Waiting for you to log in…</div>
                <div className="text-xs text-muted-foreground">
                  A Chromium window opened. Sign in to LinkedIn there.
                  Cookies save automatically as soon as you reach your feed.
                  Times out after 10 min.
                </div>
              </>
            )}
            {state.status === "error" && (
              <>
                <div className="text-sm font-medium text-destructive">Connect failed</div>
                <div className="text-xs text-muted-foreground">
                  {state.error || "Unknown error."} Try again — if it persists,
                  run <code>~/.harbour/workflows/linkedin-setup.sh</code> from a terminal to see verbose output.
                </div>
              </>
            )}
            {state.status === "disconnected" && (
              <>
                <div className="text-sm font-medium">Not connected</div>
                <div className="text-xs text-muted-foreground">
                  Click <strong>Connect</strong>. A Chromium window opens, you log in,
                  cookies save automatically.
                </div>
              </>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {state.status === "disconnected" || state.status === "error" ? (
            <Button onClick={connect} disabled={busy} className="gap-2">
              <LinkedInIcon className="h-4 w-4" />
              Connect to LinkedIn
            </Button>
          ) : null}
          {state.status === "running" && (
            <Button variant="outline" onClick={cancel} disabled={busy}>
              Cancel
            </Button>
          )}
          {state.status === "connected" && (
            <>
              <Button onClick={verify} disabled={verifying || busy} variant="outline" className="gap-2">
                {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
                Verify session
              </Button>
              <Button
                onClick={async () => {
                  setVerifying(true);
                  setVerifyResult(null);
                  const r = await fetch("/api/linkedin/detect-self", { method: "POST" });
                  const j = await r.json();
                  setVerifying(false);
                  if (r.ok && j.profileUrl) {
                    setVerifyResult({ ok: true, name: null, url: j.profileUrl });
                  } else {
                    setVerifyResult({ ok: false, error: j.error || "detection failed" });
                  }
                }}
                disabled={verifying || busy}
                variant="outline"
                className="gap-2"
              >
                <RotateCw className="h-4 w-4" />
                Auto-detect my URL
              </Button>
              <Button onClick={connect} disabled={busy} variant="outline" className="gap-2">
                <LinkedInIcon className="h-4 w-4" />
                Reconnect
              </Button>
              <Button onClick={disconnect} disabled={busy} variant="ghost" className="gap-2 text-destructive hover:text-destructive">
                <Unplug className="h-4 w-4" />
                Disconnect
              </Button>
            </>
          )}
        </div>

        {verifyResult && (
          <div
            className={`mt-4 rounded-md border p-3 text-xs ${
              verifyResult.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-100"
                : "border-destructive/30 bg-destructive/5 text-destructive"
            }`}
          >
            {verifyResult.ok ? (
              <>
                <div className="font-medium">Session valid</div>
                <div>
                  {verifyResult.name ? `Logged in as ${verifyResult.name}` : null}
                  {verifyResult.url ? ` · ${verifyResult.url}` : null}
                </div>
              </>
            ) : (
              <>
                <div className="font-medium">Session invalid</div>
                <div className="opacity-80">{verifyResult.error}</div>
                <div className="mt-1">Click <strong>Reconnect</strong> to log in again.</div>
              </>
            )}
          </div>
        )}
      </section>

      <BrowserSessionSection
        draft={draft}
        patchToggle={(v) => draft && setDraft({ ...draft, useExtensionForSend: v })}
        savingLimits={savingLimits}
        onSave={saveLimits}
        dirty={dirty}
      />

      <section className="rounded-lg border bg-card p-5">
        <div className="mb-4 flex items-start gap-3">
          <Gauge className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-medium">LinkedIn rate limits (per 24 hours)</h2>
            <p className="text-xs text-muted-foreground">
              Caps + spread used by Phase B.3 Playwright workflows. With caps at 0, no actions fire.
              <br />
              <strong>Contact</strong> = 1st-degree LinkedIn connection. <strong>Non-contact</strong> = not connected yet.
            </p>
          </div>
        </div>

        {draft ? (
          <div className="space-y-4">
            <LimitRow
              label="DMs"
              field="maxDmsPerDay"
              value={draft.maxDmsPerDay}
              used={limits?.usage.dms24h ?? 0}
              onChange={(v) => patchDraft("maxDmsPerDay", v)}
            />
            <LimitRow
              label="Comments to non-connections"
              field="maxCommentsNonContactPerDay"
              value={draft.maxCommentsNonContactPerDay}
              used={limits?.usage.commentsNonContact24h ?? 0}
              onChange={(v) => patchDraft("maxCommentsNonContactPerDay", v)}
            />
            <LimitRow
              label="Comments to connections"
              field="maxCommentsContactPerDay"
              value={draft.maxCommentsContactPerDay}
              used={limits?.usage.commentsContact24h ?? 0}
              onChange={(v) => patchDraft("maxCommentsContactPerDay", v)}
            />

            <div className="border-t pt-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Spread + spam-avoidance
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <PlainField
                  label="Spread hours"
                  hint="e.g. 8 → actions spread across an 8h window"
                  value={draft.spreadHours}
                  onChange={(v) => patchDraft("spreadHours", v)}
                />
                <PlainField
                  label="Min seconds between actions"
                  hint="cooldown after every action"
                  value={draft.minSecondsBetweenActions}
                  onChange={(v) => patchDraft("minSecondsBetweenActions", v)}
                />
                <PlainField
                  label="DM variations per lead magnet"
                  hint="distinct rewrites the AI prepares"
                  value={draft.dmRewriteVariations}
                  onChange={(v) => patchDraft("dmRewriteVariations", v)}
                />
              </div>
            </div>

            <div className="border-t pt-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Human-like pacing
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Anti-detection layer. Active hours stop 3am sends, per-hour cap prevents bursts, jitter breaks the cron fingerprint.
              </p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <PlainField
                  label="Max writes per hour"
                  hint="combined DM + comment ceiling, rolling 60m"
                  value={draft.maxWritesPerHour}
                  onChange={(v) => patchDraft("maxWritesPerHour", v)}
                />
                <PlainField
                  label="Cron jitter (max seconds)"
                  hint="random pre-sleep before each cron run"
                  value={draft.cronJitterMaxSeconds}
                  onChange={(v) => patchDraft("cronJitterMaxSeconds", v)}
                />
                <PlainField
                  label="Active hours: start (0–23)"
                  hint="local time; equal start+end = always-on"
                  value={draft.activeHoursStart}
                  onChange={(v) => patchDraft("activeHoursStart", v)}
                />
                <PlainField
                  label="Active hours: end (0–23)"
                  hint="exclusive — 22 means runs until 21:59"
                  value={draft.activeHoursEnd}
                  onChange={(v) => patchDraft("activeHoursEnd", v)}
                />
                <PlainField
                  label="Jitter min seconds"
                  hint="lower bound of random pause between writes"
                  value={draft.jitterMinSeconds}
                  onChange={(v) => patchDraft("jitterMinSeconds", v)}
                />
                <PlainField
                  label="Jitter max seconds"
                  hint="upper bound of random pause between writes"
                  value={draft.jitterMaxSeconds}
                  onChange={(v) => patchDraft("jitterMaxSeconds", v)}
                />
                <PlainField
                  label="Burst size"
                  hint="after N writes, take a longer break"
                  value={draft.burstSize}
                  onChange={(v) => patchDraft("burstSize", v)}
                />
                <PlainField
                  label="Burst break: min seconds"
                  hint="lower bound of the long pause"
                  value={draft.burstBreakMinSeconds}
                  onChange={(v) => patchDraft("burstBreakMinSeconds", v)}
                />
                <PlainField
                  label="Burst break: max seconds"
                  hint="upper bound of the long pause"
                  value={draft.burstBreakMaxSeconds}
                  onChange={(v) => patchDraft("burstBreakMaxSeconds", v)}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button onClick={saveLimits} disabled={!dirty || savingLimits} className="gap-2">
                {savingLimits ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </Button>
              {limitsMsg && <span className="text-xs text-muted-foreground">{limitsMsg}</span>}
              {dirty && !limitsMsg && (
                <span className="text-xs text-muted-foreground">Unsaved changes</span>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> loading…
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div>
              <h2 className="text-sm font-medium">Connections sync</h2>
              <p className="text-xs text-muted-foreground">
                Tags 1st-degree connections so the right cap applies.
                Last synced:{" "}
                {limits?.connectionsSyncedAt
                  ? new Date(limits.connectionsSyncedAt * 1000).toLocaleString()
                  : <em>never</em>}
              </p>
            </div>
          </div>
          <Button onClick={syncConnections} disabled={syncing} variant="outline" className="shrink-0 gap-2">
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sync now
          </Button>
        </div>
        {syncMsg && (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
            {syncMsg}
          </p>
        )}
      </section>

      <section className="space-y-3 text-sm text-muted-foreground">
        <h2 className="text-base font-medium text-foreground">What this powers</h2>
        <ul className="list-inside list-disc space-y-1">
          <li>Publishing approved drafts from <code>content/_drafts/linkedin/approved/</code> to your LinkedIn feed</li>
          <li>Posting approved replies + competitor comments</li>
          <li>Scraping DMs, comments on your posts, and competitor posts (read-only)</li>
        </ul>
        <p className="pt-2 text-xs">
          All Playwright workflows respect the <code>LINKEDIN_KILL_SWITCH</code> env var
          and a hard cap of 50 actions/hour. Re-run Connect any time the session
          expires (typically every few weeks).
        </p>
      </section>
    </div>
  );
}

function LimitRow({
  label,
  field,
  value,
  used,
  onChange,
}: {
  label: string;
  field: string;
  value: number;
  used: number;
  onChange: (v: number) => void;
}) {
  const atCap = value > 0 && used >= value;
  return (
    <div className="grid grid-cols-12 items-center gap-3">
      <Label htmlFor={field} className="col-span-6 text-sm">
        {label}
      </Label>
      <Input
        id={field}
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="col-span-3 h-9 text-right"
      />
      <div className={`col-span-3 text-xs ${atCap ? "text-destructive" : "text-muted-foreground"}`}>
        used today: <span className="font-medium">{used}</span>
        {value > 0 && ` / ${value}`}
      </div>
    </div>
  );
}

function PlainField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="h-9"
      />
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

type ExtensionKeyResp = {
  keys: Array<{ id: string; name: string; last_used_at: number | null; last_synced_at: number | null; created_at: number; created_by: string }>;
  latest_synced_at: number | null;
};

function fmtAge(ts: number | null): string {
  if (!ts) return "never";
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function BrowserSessionSection({
  draft,
  patchToggle,
  savingLimits,
  onSave,
  dirty,
}: {
  draft: LimitsConfig | null;
  patchToggle: (v: boolean) => void;
  savingLimits: boolean;
  onSave: () => Promise<void>;
  dirty: boolean;
}) {
  const [data, setData] = useState<ExtensionKeyResp | null>(null);
  const [generating, setGenerating] = useState(false);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/linkedin/extension/token");
    if (r.ok) setData(await r.json());
  }
  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  async function generateToken() {
    setGenerating(true);
    setMsg(null);
    setRawKey(null);
    try {
      const r = await fetch("/api/linkedin/extension/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Harbour Chrome extension" }),
      });
      const j = await r.json();
      if (!r.ok) {
        setMsg(j.error || "Failed");
      } else {
        setRawKey(j.apiKey);
        setMsg("Copy this token NOW — it won't be shown again.");
        await load();
      }
    } finally {
      setGenerating(false);
    }
  }

  async function deleteToken(id: string) {
    if (!confirm("Revoke this extension token? The extension using it will stop working immediately.")) return;
    await fetch(`/api/linkedin/extension/token?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await load();
  }

  async function copy(s: string) {
    try { await navigator.clipboard.writeText(s); setMsg("Copied to clipboard."); } catch { /* ignore */ }
  }

  async function downloadExtension() {
    setDownloading(true);
    setDownloadErr(null);
    try {
      const r = await fetch("/api/linkedin/extension/download");
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        setDownloadErr(text || `Download failed (HTTP ${r.status})`);
        return;
      }
      const disposition = r.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] || "harbour-linkedin-bridge.zip";
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadErr(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  const latestSyncTs = data?.latest_synced_at;
  const syncFresh = latestSyncTs != null && (Date.now() / 1000 - latestSyncTs) < 600;
  const syncStale = latestSyncTs != null && (Date.now() / 1000 - latestSyncTs) >= 14400;

  return (
    <section className="rounded-lg border bg-card p-5">
      <div className="mb-4 flex items-start gap-3">
        <Puzzle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="flex-1">
          <h2 className="text-sm font-medium">Browser session (Chrome extension)</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Install the Harbour LinkedIn Bridge extension in your daily Chrome.
            It syncs your real LinkedIn cookies + sends approved DMs via your
            actual browser — no Playwright fingerprint, no expired sessions.
          </p>
        </div>
      </div>

      <div className="mb-4 rounded-md border bg-background p-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="outline" onClick={downloadExtension} disabled={downloading} className="gap-2">
            {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Download extension
          </Button>
          <span className="text-xs text-muted-foreground">.zip · unpacked Chrome extension</span>
          {downloadErr && <span className="text-xs text-destructive">{downloadErr}</span>}
        </div>
        <ol className="mt-3 space-y-1 text-xs text-muted-foreground list-decimal pl-5">
          <li>Click <strong>Download extension</strong> above and unzip the file.</li>
          <li>Open <code className="rounded bg-muted px-1.5 py-0.5">chrome://extensions</code> in Chrome and enable <strong>Developer mode</strong> (top-right).</li>
          <li>Click <strong>Load unpacked</strong> and select the unzipped folder.</li>
          <li>Open the extension popup, paste your Harbour URL and a token from <strong>Extension tokens</strong> below, click <strong>Sync now</strong>.</li>
        </ol>
      </div>

      {/* Sync status */}
      <div className="mb-4 rounded-md border bg-background p-3 text-sm">
        {latestSyncTs == null ? (
          <span className="text-muted-foreground">No browser session synced yet. Install the extension to start.</span>
        ) : syncFresh ? (
          <span className="text-emerald-700 dark:text-emerald-300">
            🟢 Cookies synced {fmtAge(latestSyncTs)} — session is fresh.
          </span>
        ) : syncStale ? (
          <span className="text-rose-700 dark:text-rose-300">
            🔴 STALE — last sync {fmtAge(latestSyncTs)}. Open Chrome where the extension is installed.
          </span>
        ) : (
          <span className="text-amber-700 dark:text-amber-300">
            🟡 Last sync {fmtAge(latestSyncTs)}.
          </span>
        )}
      </div>

      {/* Toggle: send via extension */}
      {draft && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-md border bg-background p-3">
          <div className="text-sm">
            <div className="font-medium">Send via Chrome extension</div>
            <div className="text-xs text-muted-foreground">
              When ON, approved drafts ship from your real Chrome via LinkedIn&apos;s internal API. Playwright stands down.
            </div>
          </div>
          <label className="inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={draft.useExtensionForSend}
              onChange={(e) => patchToggle(e.target.checked)}
              className="peer sr-only"
            />
            <span className="relative h-5 w-9 rounded-full bg-muted transition-colors peer-checked:bg-primary">
              <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-background transition-transform peer-checked:translate-x-4" />
            </span>
          </label>
        </div>
      )}

      {/* Tokens */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Extension tokens</h3>
          <Button size="sm" onClick={generateToken} disabled={generating} className="gap-2">
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
            Generate new
          </Button>
        </div>

        {rawKey && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
            <div className="mb-1.5 font-medium text-amber-700 dark:text-amber-300">New token (copy now — won&apos;t be shown again)</div>
            <code className="block break-all rounded bg-background p-2 font-mono text-xs">{rawKey}</code>
            <Button size="sm" variant="outline" onClick={() => copy(rawKey)} className="mt-2 gap-1.5">
              <Copy className="h-3 w-3" /> Copy
            </Button>
          </div>
        )}

        {data?.keys?.length ? (
          <div className="space-y-1.5">
            {data.keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-xs">
                <div className="min-w-0">
                  <div className="font-medium">{k.name}</div>
                  <div className="text-muted-foreground">
                    by {k.created_by} · last used {fmtAge(k.last_used_at)} · last sync {fmtAge(k.last_synced_at)}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => deleteToken(k.id)} className="gap-1 text-destructive hover:text-destructive">
                  <Trash2 className="h-3 w-3" /> Revoke
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
            No extension tokens yet. Generate one + paste into the extension popup.
          </div>
        )}

        {msg && <div className="text-xs text-muted-foreground">{msg}</div>}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button onClick={onSave} disabled={!dirty || savingLimits} size="sm" className="gap-2">
          {savingLimits ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save toggle change
        </Button>
        {dirty && <span className="text-xs text-muted-foreground">Unsaved toggle change</span>}
      </div>
    </section>
  );
}
