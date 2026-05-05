import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth";
import { getTaskById, archiveTask } from "@/lib/db/queries";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withUserAuth(async (_req: NextRequest, _auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  const task = getTaskById(id);
  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });
  archiveTask(id);
  return NextResponse.json({ ok: true });
});
