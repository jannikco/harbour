import { NextRequest, NextResponse } from "next/server";
import { withAuth, requireTaskClaim } from "@/lib/auth";
import {
  getTaskById,
  addTaskActivity,
  hasActiveTaskClaim,
  listTaskActivity,
  listStagesForBoard,
} from "@/lib/db/queries";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withAuth(async (_req: NextRequest, _auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  const task = getTaskById(id);
  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });
  const activity = listTaskActivity(id);
  const stages = listStagesForBoard(task.board_id);
  const stageMap: Record<string, string> = {};
  for (const s of stages) stageMap[s.id] = s.name;
  return NextResponse.json(activity.map(a => ({
    ...a,
    from_stage_name: a.from_stage_id ? (stageMap[a.from_stage_id] ?? null) : null,
    to_stage_name: a.to_stage_id ? (stageMap[a.to_stage_id] ?? null) : null,
  })));
});

export const POST = withAuth(async (req: NextRequest, auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  const task = getTaskById(id);
  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });

  // Agents may only post activity on a task they currently have claimed.
  const claimError = requireTaskClaim(auth, id, hasActiveTaskClaim);
  if (claimError) return claimError;

  const body = await req.json() as { content?: string };
  const content = (body.content ?? "").trim();
  if (!content) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  const authorType = auth.type === "user" ? "user" : "agent";
  const authorId = auth.type === "user" ? auth.userId : auth.agentId;
  const authorName = auth.type === "user" ? auth.displayName : auth.agentName;

  // If the activity is posted from inside a run, attach the run id so the
  // task timeline shows which run produced the comment.
  const runId = req.headers.get("x-harbour-run-id") || null;

  const entry = addTaskActivity({
    taskId: id,
    kind: "comment",
    authorType,
    authorId,
    authorName,
    content,
    runId,
  });
  return NextResponse.json(entry, { status: 201 });
});
