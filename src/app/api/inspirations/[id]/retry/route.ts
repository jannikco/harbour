import { NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth";
import {
  getInspirationPost,
  resetInspirationPost,
  setInspirationRun,
  triggerJobRun,
} from "@/lib/db/queries";
import { ensureInspirationsProcessor } from "@/lib/inspirations/ensure-processor";

export const POST = withUserAuth(async (req, _auth, { params }) => {
  const { id } = await params;
  const existing = getInspirationPost(id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const reset = resetInspirationPost(id);
  if (!reset) return NextResponse.json({ error: "reset failed" }, { status: 500 });

  const origin = req.headers.get("origin") || `http://localhost:${process.env.PORT || 3000}`;
  const processor = ensureInspirationsProcessor(origin);

  const run = triggerJobRun(
    processor.jobId,
    JSON.stringify({ inspiration_post_id: id, url: existing.url }),
  );
  if (run) setInspirationRun(id, run.runId);

  return NextResponse.json(getInspirationPost(id));
});
