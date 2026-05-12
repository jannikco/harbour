import { NextResponse } from "next/server";
import { withAuth, withUserAuth } from "@/lib/auth";
import {
  getInspirationPost,
  updateInspirationPost,
  deleteInspirationPost,
  type InspirationStatus,
} from "@/lib/db/queries";

export const GET = withAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  const row = getInspirationPost(id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
});

const VALID_STATUSES: InspirationStatus[] = ["queued", "processing", "done", "failed"];

export const PATCH = withAuth(async (req, _auth, { params }) => {
  const { id } = await params;
  const existing = getInspirationPost(id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "body must be a JSON object" }, { status: 400 });
  }

  const patch: Parameters<typeof updateInspirationPost>[1] = {};

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: `status must be one of ${VALID_STATUSES.join(", ")}` }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (body.source_author !== undefined) patch.source_author = body.source_author;
  if (body.source_author_url !== undefined) patch.source_author_url = body.source_author_url;
  if (body.source_posted_at_text !== undefined) patch.source_posted_at_text = body.source_posted_at_text;
  if (body.source_text !== undefined) patch.source_text = body.source_text;
  if (body.source_image_urls !== undefined) {
    patch.source_image_urls = Array.isArray(body.source_image_urls)
      ? body.source_image_urls.map((s: unknown) => String(s))
      : null;
  }
  if (body.source_reactions !== undefined) patch.source_reactions = body.source_reactions === null ? null : Number(body.source_reactions);
  if (body.source_comments !== undefined) patch.source_comments = body.source_comments === null ? null : Number(body.source_comments);
  if (body.analysis !== undefined) patch.analysis = body.analysis;
  if (body.post_draft !== undefined) patch.post_draft = body.post_draft;
  if (body.reply_draft !== undefined) patch.reply_draft = body.reply_draft;
  if (body.topic_ideas !== undefined) {
    patch.topic_ideas = Array.isArray(body.topic_ideas)
      ? body.topic_ideas.map((s: unknown) => String(s))
      : null;
  }
  if (body.error !== undefined) patch.error = body.error;

  const updated = updateInspirationPost(id, patch);
  return NextResponse.json(updated);
});

export const DELETE = withUserAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  deleteInspirationPost(id);
  return NextResponse.json({ ok: true });
});
