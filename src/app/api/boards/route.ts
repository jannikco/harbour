import { NextRequest, NextResponse } from "next/server";
import { withAuth, withUserAuth } from "@/lib/auth";
import { listBoards, createBoard, getProjectById } from "@/lib/db/queries";

export const GET = withAuth(async () => {
  return NextResponse.json(listBoards());
});

export const POST = withUserAuth(async (req: NextRequest) => {
  const body = await req.json() as { name?: string; projectId?: string | null };
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (body.projectId) {
    const project = getProjectById(body.projectId);
    if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  const board = createBoard({ name: body.name.trim(), projectId: body.projectId ?? null });
  return NextResponse.json(board, { status: 201 });
});
