import { NextRequest, NextResponse } from "next/server";
import { withAuth, withUserAuth } from "@/lib/auth";
import {
  getBoardById,
  listStagesForBoard,
  createStage,
  reorderStages,
  setStageTransitions,
  countJobsWatching,
} from "@/lib/db/queries";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withAuth(async (_req: NextRequest, _auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  const board = getBoardById(id);
  if (!board) return NextResponse.json({ error: "board not found" }, { status: 404 });
  const stages = listStagesForBoard(id);
  const enriched = stages.map(s => ({ ...s, jobs_watching: countJobsWatching(s.id) }));
  return NextResponse.json(enriched);
});

export const POST = withUserAuth(async (req: NextRequest, _auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  const board = getBoardById(id);
  if (!board) return NextResponse.json({ error: "board not found" }, { status: 404 });

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
 */
export const PUT = withUserAuth(async (req: NextRequest, _auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  const board = getBoardById(id);
  if (!board) return NextResponse.json({ error: "board not found" }, { status: 404 });

  const body = await req.json() as {
    order?: string[];
    transitions?: Record<string, string[]>;
  };

  try {
    if (body.order) reorderStages(id, body.order);
    if (body.transitions) {
      const stages = listStagesForBoard(id);
      const validIds = new Set(stages.map(s => s.id));
      for (const [fromId, toIds] of Object.entries(body.transitions)) {
        if (!validIds.has(fromId)) {
          return NextResponse.json({ error: `stage ${fromId} not on board` }, { status: 400 });
        }
        setStageTransitions(fromId, toIds);
      }
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "update failed" }, { status: 400 });
  }

  const stages = listStagesForBoard(id).map(s => ({ ...s, jobs_watching: countJobsWatching(s.id) }));
  return NextResponse.json(stages);
});
