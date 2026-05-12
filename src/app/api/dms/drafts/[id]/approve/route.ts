import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { setDraftStatus } from "@/lib/dms-db";
import { triggerJobRun } from "@/lib/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Workflow-only job that pulls approved drafts and sends them via Playwright,
// gated by the LinkedIn rate-limit kill switch in linkedin-limits.json.
const SEND_DM_JOB_ID = "3437f477-c8f4-43b8-ab3f-c653c8c9c623";

export const POST = withAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  const n = parseInt(id, 10);
  if (!Number.isFinite(n)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const d = setDraftStatus(n, "approved");
  if (!d) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Fire the send job NOW instead of waiting up to 30min for the next cron tick.
  // The workflow itself checks the kill switch (maxDmsPerDay=0 → exit 77 cleanly),
  // so this is safe even when auto-send is disabled — it just no-ops.
  let triggered = false;
  try {
    triggerJobRun(SEND_DM_JOB_ID, `Auto-triggered by draft ${n} approval`);
    triggered = true;
  } catch (err) {
    console.error("send job trigger failed (non-fatal):", err);
  }

  return NextResponse.json({ ...d, send_triggered: triggered });
});
