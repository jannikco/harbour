import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth";
import {
  getBoardById,
  getStageById,
  updateStage,
  deleteStage,
} from "@/lib/db/queries";

type RouteContext = { params: Promise<{ id: string; stageId: string }> };

export const PUT = withUserAuth(async (req: NextRequest, _auth, ctx) => {
  const { id, stageId } = await (ctx as RouteContext).params;
  const board = getBoardById(id);
  if (!board) return NextResponse.json({ error: "board not found" }, { status: 404 });
  const stage = getStageById(stageId);
  if (!stage || stage.board_id !== id) {
    return NextResponse.json({ error: "stage not found on this board" }, { status: 404 });
  }
  const body = await req.json() as { name?: string; is_terminal?: boolean };
  return NextResponse.json(updateStage(stageId, body));
});

export const DELETE = withUserAuth(async (_req: NextRequest, _auth, ctx) => {
  const { id, stageId } = await (ctx as RouteContext).params;
  const board = getBoardById(id);
  if (!board) return NextResponse.json({ error: "board not found" }, { status: 404 });
  const stage = getStageById(stageId);
  if (!stage || stage.board_id !== id) {
    return NextResponse.json({ error: "stage not found on this board" }, { status: 404 });
  }
  const result = deleteStage(stageId);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
});
