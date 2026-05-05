import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth";
import {
  getProjectById,
  getStageById,
  updateStage,
  deleteStage,
} from "@/lib/db/queries";

type RouteContext = { params: Promise<{ id: string; stageId: string }> };

export const PUT = withUserAuth(async (req: NextRequest, _auth, ctx) => {
  const { id, stageId } = await (ctx as RouteContext).params;
  const project = getProjectById(id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
  const stage = getStageById(stageId);
  if (!stage || stage.project_id !== id) {
    return NextResponse.json({ error: "stage not found in this project" }, { status: 404 });
  }
  const body = await req.json() as { name?: string; is_terminal?: boolean };
  const updated = updateStage(stageId, body);
  return NextResponse.json(updated);
});

export const DELETE = withUserAuth(async (_req: NextRequest, _auth, ctx) => {
  const { id, stageId } = await (ctx as RouteContext).params;
  const project = getProjectById(id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
  const stage = getStageById(stageId);
  if (!stage || stage.project_id !== id) {
    return NextResponse.json({ error: "stage not found in this project" }, { status: 404 });
  }
  const result = deleteStage(stageId);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
});
