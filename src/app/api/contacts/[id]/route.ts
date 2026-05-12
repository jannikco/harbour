import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import {
  getContact,
  updateContact,
  deleteContact,
  type UpdateContactInput,
} from "@/lib/contacts-db";
import { isValidStatus, isValidLinkedInUrl } from "@/lib/contacts-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  const n = parseInt(id, 10);
  if (!Number.isFinite(n)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const got = getContact(n);
  if (!got) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(got);
});

export const PATCH = withAuth(async (req, _auth, { params }) => {
  const { id } = await params;
  const n = parseInt(id, 10);
  if (!Number.isFinite(n)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));

  if (body.linkedin_url !== undefined && body.linkedin_url !== null && body.linkedin_url !== "") {
    if (!isValidLinkedInUrl(body.linkedin_url)) {
      return NextResponse.json({ error: "invalid linkedin_url" }, { status: 400 });
    }
  }
  if (body.status !== undefined && body.status !== null && !isValidStatus(body.status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }
  const patch: UpdateContactInput = {};
  for (const key of [
    "linkedin_url",
    "email",
    "name",
    "headline",
    "company",
    "tags",
    "status",
    "language",
    "notes",
    "last_interaction_at",
  ] as const) {
    if (body[key] !== undefined) {
      (patch as Record<string, unknown>)[key] = body[key];
    }
  }

  const updated = updateContact(n, patch);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(updated);
});

export const DELETE = withAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  const n = parseInt(id, 10);
  if (!Number.isFinite(n)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const ok = deleteContact(n);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
});
