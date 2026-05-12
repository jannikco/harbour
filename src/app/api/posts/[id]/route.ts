import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getPostWithComments } from "@/lib/posts-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  const n = parseInt(id, 10);
  if (!Number.isFinite(n)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const got = getPostWithComments(n);
  if (!got) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(got);
});
