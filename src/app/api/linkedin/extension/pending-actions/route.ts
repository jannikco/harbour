// Pending-action queue for the Chrome extension. Returns approved DM drafts
// that the extension should send via LinkedIn's Voyager API from the user's
// real browser. The same pacing layer that gates Playwright sends gates this
// queue — only what's safe to send RIGHT NOW is returned.

import { NextResponse } from "next/server";
import { withExtensionAuth } from "@/lib/auth";
import { getDb } from "@/lib/db/schema";
import { readLimits, computeUsage, computeUsageWindow } from "@/lib/linkedin-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Action = {
  id: number;
  kind: "send_dm";
  conversation_urn: string;
  thread_url: string;
  body: string;
  contact_id: number;
  contact_name: string | null;
};

function extractConversationUrn(threadUrl: string | null): string | null {
  if (!threadUrl) return null;
  const m = threadUrl.match(/\/messaging\/thread\/([^/?#]+)/);
  if (!m) return null;
  // LinkedIn returns URL-safe base64-ish strings like 2-ABCxyz==
  return decodeURIComponent(m[1]);
}

export const GET = withExtensionAuth(async () => {
  const limits = readLimits();

  // Hard gates: kill switch + extension-mode toggle.
  if (!limits.useExtensionForSend) {
    return NextResponse.json({ actions: [], skip_reason: "extension send disabled (toggle 'Send via Chrome extension' in /linkedin)" });
  }
  if (limits.maxDmsPerDay <= 0) {
    return NextResponse.json({ actions: [], skip_reason: "maxDmsPerDay=0 (kill switch)" });
  }

  // Active hours check (use the same logic as _pacing.mjs).
  const h = new Date().getHours();
  const s = limits.activeHoursStart, e = limits.activeHoursEnd;
  const inActiveHours = s === e ? true : (s < e ? (h >= s && h < e) : (h >= s || h < e));
  if (!inActiveHours) {
    return NextResponse.json({ actions: [], skip_reason: `outside active hours (${s}-${e}h local; now ${h}h)` });
  }

  // Per-hour + per-day budgets — same math as send workflow.
  const usage = computeUsage();
  const last60 = computeUsageWindow(3600);
  const dailyRemaining = Math.max(0, limits.maxDmsPerDay - usage.dms24h);
  const hourlyRemaining = Math.max(0, limits.maxWritesPerHour - last60.writes);
  const budget = Math.min(dailyRemaining, hourlyRemaining);
  if (budget <= 0) {
    return NextResponse.json({
      actions: [],
      skip_reason: `budget exhausted (daily=${dailyRemaining}, hourly=${hourlyRemaining})`,
    });
  }

  const db = getDb();
  // Pull approved reply drafts ordered oldest-first; resolve thread_url + contact name.
  const rows = db.prepare(`
    SELECT r._id AS draft_id,
           r.contact_db_id AS contact_id,
           r.content_excerpt AS body,
           (SELECT post_url FROM d_interactions d
            WHERE d.contact_db_id = r.contact_db_id AND d.type='dm'
              AND d.post_url LIKE '%/messaging/thread/%'
            ORDER BY d.created_at DESC LIMIT 1) AS thread_url,
           c.name AS contact_name
    FROM d_interactions r
    JOIN d_contacts c ON c._id = r.contact_db_id
    WHERE r.type='reply' AND r.direction='out'
      AND r.channel='linkedin' AND r.draft_status='approved'
    ORDER BY r.created_at ASC
    LIMIT ?
  `).all(budget) as Array<{
    draft_id: number;
    contact_id: number;
    body: string;
    thread_url: string | null;
    contact_name: string | null;
  }>;

  const actions: Action[] = [];
  for (const r of rows) {
    const urn = extractConversationUrn(r.thread_url);
    if (!urn || !r.body) continue;
    actions.push({
      id: r.draft_id,
      kind: "send_dm",
      conversation_urn: urn,
      thread_url: r.thread_url!,
      body: r.body,
      contact_id: r.contact_id,
      contact_name: r.contact_name,
    });
  }

  return NextResponse.json({
    actions,
    budget,
    sent_today: usage.dms24h,
    writes_last_hour: last60.writes,
    limits: {
      max_dms_per_day: limits.maxDmsPerDay,
      max_writes_per_hour: limits.maxWritesPerHour,
    },
  });
});

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
