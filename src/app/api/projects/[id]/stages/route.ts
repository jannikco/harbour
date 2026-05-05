import { NextRequest, NextResponse } from "next/server";
import { withAuth, withUserAuth } from "@/lib/auth";
import {
  getProjectById,
  listStagesForProject,
  createStage,
  reorderStages,
  setStageTransitions,
  countJobsWatching,
} from "@/lib/db/queries";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withAuth(async (_req: NextRequest, _auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  const project = getProjectById(id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
  const stages = listStagesForProject(id);
  // Annotate with jobs-watching count so the UI can warn about hot stages
  const enriched = stages.map(s => ({ ...s, jobs_watching: countJobsWatching(s.id) }));
  return NextResponse.json(enriched);
});

export const POST = withUserAuth(async (req: NextRequest, _auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  const project = getProjectById(id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const body = await req.json() as { name?: string; is_terminal?: boolean };
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const stage = createStage(id, { name: body.name.trim(), is_terminal: !!body.is_terminal });
  return NextResponse.json(stage, { status: 201 });
});

/**
 * Bulk update of the board layout in one call. Body shape:
 * {
 *   order: string[]                                       — ordered stage IDs
 *   transitions: { [fromStageId]: string[] }              — outgoing edges
 * }
 * Either field is optional; only the provided ones are applied.
 */
export const PUT = withUserAuth(async (req: NextRequest, _auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  const project = getProjectById(id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const body = await req.json() as {
    order?: string[];
    transitions?: Record<string, string[]>;
  };

  try {
    if (body.order) {
      reorderStages(id, body.order);
    }
    if (body.transitions) {
      const stages = listStagesForProject(id);
      const validIds = new Set(stages.map(s => s.id));
      for (const [fromId, toIds] of Object.entries(body.transitions)) {
        if (!validIds.has(fromId)) {
          return NextResponse.json({ error: `stage ${fromId} not in project` }, { status: 400 });
        }
        setStageTransitions(fromId, toIds);
      }
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "update failed" }, { status: 400 });
  }

  const stages = listStagesForProject(id).map(s => ({ ...s, jobs_watching: countJobsWatching(s.id) }));
  return NextResponse.json(stages);
});
