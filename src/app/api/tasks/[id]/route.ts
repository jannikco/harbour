import { NextRequest, NextResponse } from "next/server";
import { withAuth, withUserAuth } from "@/lib/auth";
import {
  getTaskById,
  getTaskWithStage,
  listTaskActivity,
  updateTask,
  deleteTask,
  listStagesForBoard,
} from "@/lib/db/queries";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withAuth(async (_req: NextRequest, _auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  const task = getTaskWithStage(id);
  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });
  const activity = listTaskActivity(id);
  // Resolve stage names for stage_change activity entries
  const stages = listStagesForBoard(task.board_id);
  const stageMap: Record<string, string> = {};
  for (const s of stages) stageMap[s.id] = s.name;
  const enriched = activity.map(a => ({
    ...a,
    from_stage_name: a.from_stage_id ? (stageMap[a.from_stage_id] ?? null) : null,
    to_stage_name: a.to_stage_id ? (stageMap[a.to_stage_id] ?? null) : null,
  }));
  return NextResponse.json({ ...task, activity: enriched });
});

export const PUT = withAuth(async (req: NextRequest, _auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  const body = await req.json() as { title?: string; description?: string };
  const task = getTaskById(id);
  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });
  const updated = updateTask(id, body);
  return NextResponse.json(updated);
});

export const DELETE = withUserAuth(async (_req: NextRequest, _auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  const task = getTaskById(id);
  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });
  deleteTask(id);
  return NextResponse.json({ ok: true });
});
