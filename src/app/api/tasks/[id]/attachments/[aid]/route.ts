import { NextResponse } from "next/server";
import { withAuth, requireTaskClaim } from "@/lib/auth";
import { getTaskById, getAttachmentById, deleteAttachment, hasActiveTaskClaim } from "@/lib/db/queries";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; aid: string }> };

export const DELETE = withAuth(async (_req, auth, ctx) => {
  const { id, aid } = await (ctx as RouteContext).params;
  const task = getTaskById(id);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const claimError = requireTaskClaim(auth, id, hasActiveTaskClaim);
  if (claimError) return claimError;

  const att = getAttachmentById(aid);
  if (!att || att.task_id !== id) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }
  deleteAttachment(aid);
  return NextResponse.json({ ok: true });
});
