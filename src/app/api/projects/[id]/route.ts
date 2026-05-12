import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth";
import {
  getProjectById,
  updateProject,
  deleteProject,
  linkAgentToProject,
  unlinkAgentFromProject,
  linkJobToProject,
  unlinkJobFromProject,
  linkDocToProject,
  unlinkDocFromProject,
  linkEnvVarToProject,
  unlinkEnvVarFromProject,
  linkDatabaseToProject,
  unlinkDatabaseFromProject,
  linkInspirationToProject,
  unlinkInspirationFromProject,
} from "@/lib/db/queries";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withUserAuth(async (req: NextRequest, auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  const project = getProjectById(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(project);
});

export const PUT = withUserAuth(async (req: NextRequest, auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  const body = await req.json();
  const project = updateProject(id, body);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(project);
});

export const DELETE = withUserAuth(async (req: NextRequest, auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  deleteProject(id);
  return NextResponse.json({ ok: true });
});

// PATCH: link/unlink entities to/from this project
export const PATCH = withUserAuth(async (req: NextRequest, auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  const project = getProjectById(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json();
  const { action, type, targetId } = body as { action: string; type: string; targetId: string };

  if (!action || !type || !targetId) {
    return NextResponse.json({ error: "action, type, and targetId are required" }, { status: 400 });
  }

  const linkers: Record<string, { link: (p: string, t: string) => void; unlink: (p: string, t: string) => void }> = {
    agent: { link: linkAgentToProject, unlink: unlinkAgentFromProject },
    job: { link: linkJobToProject, unlink: unlinkJobFromProject },
    doc: { link: linkDocToProject, unlink: unlinkDocFromProject },
    "env-var": { link: linkEnvVarToProject, unlink: unlinkEnvVarFromProject },
    database: { link: linkDatabaseToProject, unlink: unlinkDatabaseFromProject },
    inspiration: { link: linkInspirationToProject, unlink: unlinkInspirationFromProject },
  };

  const linker = linkers[type];
  if (!linker) {
    return NextResponse.json({ error: `invalid type: ${type}` }, { status: 400 });
  }

  if (action === "link") {
    linker.link(id, targetId);
  } else if (action === "unlink") {
    linker.unlink(id, targetId);
  } else {
    return NextResponse.json({ error: `invalid action: ${action}` }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
});
