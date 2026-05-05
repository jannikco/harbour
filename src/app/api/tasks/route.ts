import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import {
  createTask,
  getProjectById,
  getStageById,
  listTasksByProject,
} from "@/lib/db/queries";

export const GET = withAuth(async (req: NextRequest) => {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }
  const project = getProjectById(projectId);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
  return NextResponse.json(listTasksByProject(projectId));
});

export const POST = withAuth(async (req: NextRequest, auth) => {
  const body = await req.json() as {
    projectId?: string;
    stageId?: string;
    title?: string;
    description?: string;
    insertAt?: "top" | "bottom";
  };
  if (!body.projectId || !body.stageId || !body.title?.trim()) {
    return NextResponse.json({ error: "projectId, stageId, and title are required" }, { status: 400 });
  }
  const project = getProjectById(body.projectId);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
  const stage = getStageById(body.stageId);
  if (!stage || stage.project_id !== body.projectId) {
    return NextResponse.json({ error: "stage not found in this project" }, { status: 404 });
  }

  const authorType = auth.type === "user" ? "user" : "agent";
  const authorId = auth.type === "user" ? auth.userId : auth.agentId;
  const authorName = auth.type === "user" ? auth.displayName : auth.agentName;

  const task = createTask({
    projectId: body.projectId,
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
