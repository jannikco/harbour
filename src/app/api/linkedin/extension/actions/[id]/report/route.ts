// Extension reports the result of an action. On success, mark the draft sent
// + insert a mirror outbound dm row (same shape the Playwright workflow uses)
// so funnel-stage detection sees real outbound activity. On failure, mark the
// draft needs-human with the error message stashed in content.

import { NextResponse } from "next/server";
import { withExtensionAuth } from "@/lib/auth";
import { getDb } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withExtensionAuth(async (req, _auth, { params }) => {
  const { id } = await params;
  const draftId = parseInt(id, 10);
  if (!Number.isFinite(draftId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const body = await req.json().catch(() => null) as {
    ok?: boolean;
    error?: string;
    linkedin_status?: number;
  } | null;
  if (!body || typeof body.ok !== "boolean") {
    return NextResponse.json({ error: "ok boolean required in body" }, { status: 400 });
  }

  const db = getDb();
  const draft = db.prepare(`
    SELECT _id, contact_db_id, content_excerpt, draft_status,
           (SELECT post_url FROM d_interactions d
            WHERE d.contact_db_id = d_interactions.contact_db_id AND d.type='dm'
              AND d.post_url LIKE '%/messaging/thread/%'
            ORDER BY d.created_at DESC LIMIT 1) AS thread_url
    FROM d_interactions
    WHERE _id = ? AND type='reply' AND direction='out'
  `).get(draftId) as { _id: number; contact_db_id: number; content_excerpt: string; draft_status: string; thread_url: string | null } | undefined;

  if (!draft) {
    return NextResponse.json({ error: "draft not found" }, { status: 404 });
  }
  if (draft.draft_status === "sent") {
    return NextResponse.json({ ok: true, already_sent: true });
  }

  const nowSec = Math.floor(Date.now() / 1000);

  if (body.ok) {
    db.prepare(`UPDATE d_interactions SET draft_status='sent', sent_at=? WHERE _id=?`).run(nowSec, draftId);
    db.prepare(`
      INSERT INTO d_interactions
        (contact_db_id, type, direction, channel, content_excerpt, post_url,
         run_id, created_at, sent_at, draft_status)
      VALUES (?, 'dm', 'out', 'linkedin', ?, ?, ?, ?, ?, 'sent')
    `).run(
      draft.contact_db_id,
      draft.content_excerpt,
      draft.thread_url,
      `extension-sender-${draftId}`,
      nowSec,
      nowSec
    );
    db.prepare(`UPDATE d_contacts SET last_interaction_at = MAX(COALESCE(last_interaction_at,0), ?) WHERE _id = ?`).run(nowSec, draft.contact_db_id);
    return NextResponse.json({ ok: true, marked_sent: true });
  }

  // Failure path: mark needs-human, retain original draft text + append error.
  const err = (body.error || "unknown error").slice(0, 500);
  const status = body.linkedin_status;
  const newText = `${draft.content_excerpt}\n\n---\n[extension send failed${status ? ` (HTTP ${status})` : ""}]: ${err}`;
  db.prepare(`UPDATE d_interactions SET draft_status='needs-human', content_excerpt=? WHERE _id=?`).run(newText, draftId);
  return NextResponse.json({ ok: false, marked_needs_human: true });
});

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
