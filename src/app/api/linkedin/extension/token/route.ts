// Extension token management. POST creates a new key + returns the raw value
// (visible ONCE). DELETE rotates (deletes the named key). GET lists keys
// without exposing the raw values.

import { NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth";
import {
  createExtensionApiKey,
  listExtensionApiKeys,
  deleteExtensionApiKey,
  getLatestExtensionSync,
} from "@/lib/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withUserAuth(async () => {
  const keys = listExtensionApiKeys();
  const latestSync = getLatestExtensionSync();
  return NextResponse.json({ keys, latest_synced_at: latestSync });
});

export const POST = withUserAuth(async (req, auth) => {
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" && body.name.trim().length > 0
    ? body.name.trim().slice(0, 80)
    : "Harbour Chrome extension";
  const created = createExtensionApiKey(name, auth.userId);
  return NextResponse.json({ id: created.id, name: created.name, apiKey: created.apiKey });
});

export const DELETE = withUserAuth(async (req) => {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id query param required" }, { status: 400 });
  }
  deleteExtensionApiKey(id);
  return NextResponse.json({ ok: true });
});
