import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getDraftById, updateDraftText } from "@/lib/dms-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  const n = parseInt(id, 10);
  if (!Number.isFinite(n)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const d = getDraftById(n);
  if (!d) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(d);
});

export const PATCH = withAuth(async (req, _auth, { params }) => {
  const { id } = await params;
  const n = parseInt(id, 10);
  if (!Number.isFinite(n)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.text !== "string") {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  const updated = updateDraftText(n, body.text);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(updated);
});
