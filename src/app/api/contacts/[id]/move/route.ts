import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { updateContact } from "@/lib/contacts-db";
import { isValidStatus } from "@/lib/contacts-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async (req, _auth, { params }) => {
  const { id } = await params;
  const n = parseInt(id, 10);
  if (!Number.isFinite(n)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  if (!isValidStatus(body.status)) {
    return NextResponse.json({ error: "status must be one of new/engaged/qualified/customer/cold/do-not-contact" }, { status: 400 });
  }

  const updated = updateContact(n, { status: body.status });
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(updated);
});
