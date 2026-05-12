import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getDmThread } from "@/lib/dms-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (_req, _auth, { params }) => {
  const { contactId } = await params;
  const id = parseInt(contactId, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const thread = getDmThread(id);
  if (!thread) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(thread);
});
