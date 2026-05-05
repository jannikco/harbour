import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import {
  getProjectById,
  listStagesForProject,
  listTasksByProject,
  countJobsWatching,
} from "@/lib/db/queries";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Bundled board view: stages + their tasks, in display order. The kanban UI
 * uses this single round-trip to render everything.
 */
export const GET = withAuth(async (_req: NextRequest, _auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  const project = getProjectById(id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const stages = listStagesForProject(id).map(s => ({
    ...s,
    jobs_watching: countJobsWatching(s.id),
  }));
  const tasks = listTasksByProject(id) as any[];

  const grouped: Record<string, any[]> = {};
  for (const s of stages) grouped[s.id] = [];
  for (const t of tasks) {
    if (grouped[t.stage_id]) grouped[t.stage_id].push(t);
  }

  return NextResponse.json({
    project,
    stages: stages.map(s => ({ ...s, tasks: grouped[s.id] })),
  });
});
