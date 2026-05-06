import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import {
  createTask,
  getBoardById,
  getStageById,
  listTasksByBoard,
} from "@/lib/db/queries";

export const GET = withAuth(async (req: NextRequest) => {
  const boardId = req.nextUrl.searchParams.get("boardId");
  if (!boardId) {
    return NextResponse.json({ error: "boardId is required" }, { status: 400 });
  }
  const board = getBoardById(boardId);
  if (!board) return NextResponse.json({ error: "board not found" }, { status: 404 });
  return NextResponse.json(listTasksByBoard(boardId));
});

export const POST = withAuth(async (req: NextRequest, auth) => {
  const body = await req.json() as {
    boardId?: string;
    stageId?: string;
    title?: string;
    description?: string;
    insertAt?: "top" | "bottom";
  };
  if (!body.boardId || !body.stageId || !body.title?.trim()) {
    return NextResponse.json({ error: "boardId, stageId, and title are required" }, { status: 400 });
  }
  const board = getBoardById(body.boardId);
  if (!board) return NextResponse.json({ error: "board not found" }, { status: 404 });
  const stage = getStageById(body.stageId);
  if (!stage || stage.board_id !== body.boardId) {
    return NextResponse.json({ error: "stage not found on this board" }, { status: 404 });
  }

  const authorType = auth.type === "user" ? "user" : "agent";
  const authorId = auth.type === "user" ? auth.userId : auth.agentId;
  const authorName = auth.type === "user" ? auth.displayName : auth.agentName;

  const task = createTask({
    boardId: body.boardId,
    stageId: body.stageId,
    title: body.title,
    description: body.description ?? null,
    insertAt: body.insertAt ?? "bottom",
    authorType,
    authorId,
    authorName,
  });
  return NextResponse.json(task, { status: 201 });
});
