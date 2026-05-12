import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { listPosts } from "@/lib/posts-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  return NextResponse.json({ posts: listPosts() });
});
