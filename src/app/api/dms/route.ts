import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { listDmThreadsWithAgg } from "@/lib/dms-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req) => {
  const url = new URL(req.url);
  const unreplied = url.searchParams.get("filter") === "unreplied";
  const limit = parseInt(url.searchParams.get("limit") || "100", 10) || 100;
  const threads = listDmThreadsWithAgg({ unreplied, limit });
  return NextResponse.json({ threads });
});
