import { NextRequest, NextResponse } from "next/server";
import { withAuth, withUserAuth } from "@/lib/auth";
import {
  getBoardById,
  updateBoard,
  deleteBoard,
  listStagesForBoard,
  listTasksByBoard,
  countJobsWatching,
} from "@/lib/db/queries";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Bundled board view: stages + their tasks, in display order. The kanban UI
 * uses this in a single round-trip.
 */
export const GET = withAuth(async (_req: NextRequest, _auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  const board = getBoardById(id);
  if (!board) return NextResponse.json({ error: "board not found" }, { status: 404 });

  const stages = listStagesForBoard(id).map(s => ({
    ...s,
    jobs_watching: countJobsWatching(s.id),
  }));
  const tasks = listTasksByBoard(id) as any[];

  const grouped: Record<string, any[]> = {};
  for (const s of stages) grouped[s.id] = [];
  for (const t of tasks) {
    if (grouped[t.stage_id]) grouped[t.stage_id].push(t);
  }

  return NextResponse.json({
    board,
    stages: stages.map(s => ({ ...s, tasks: grouped[s.id] })),
  });
});

export const PUT = withUserAuth(async (req: NextRequest, _auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  const board = getBoardById(id);
  if (!board) return NextResponse.json({ error: "board not found" }, { status: 404 });
  const body = await req.json() as { name?: string };
  return NextResponse.json(updateBoard(id, body));
});

export const DELETE = withUserAuth(async (_req: NextRequest, _auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  const board = getBoardById(id);
  if (!board) return NextResponse.json({ error: "board not found" }, { status: 404 });
  deleteBoard(id);
  return NextResponse.json({ ok: true });
});
