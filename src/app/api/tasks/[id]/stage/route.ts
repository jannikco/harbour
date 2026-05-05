import { NextRequest, NextResponse } from "next/server";
import { withAuth, requireTaskClaim } from "@/lib/auth";
import {
  getTaskById,
  moveTaskToStage,
  hasActiveTaskClaim,
} from "@/lib/db/queries";

type RouteContext = { params: Promise<{ id: string }> };

export const PUT = withAuth(async (req: NextRequest, auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  const task = getTaskById(id);
  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });

  // Agents may only move a task they currently have claimed.
  const claimError = requireTaskClaim(auth, id, hasActiveTaskClaim);
  if (claimError) return claimError;

  const body = await req.json() as { toStageId?: string; comment?: string };
  if (!body.toStageId) {
    return NextResponse.json({ error: "toStageId is required" }, { status: 400 });
  }

  const authorType = auth.type === "user" ? "user" : "agent";
  const authorId = auth.type === "user" ? auth.userId : auth.agentId;
  const authorName = auth.type === "user" ? auth.displayName : auth.agentName;
  const runId = req.headers.get("x-harbour-run-id") || null;

  const result = moveTaskToStage(id, body.toStageId, {
    authorType,
    authorId,
    authorName,
    content: body.comment ?? null,
    runId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }
  return NextResponse.json(result.task);
});
