import { NextRequest, NextResponse } from "next/server";
import { withAuth, requireAgentOwnership } from "@/lib/auth";
import {
  getRunById,
  updateRunStatus,
  addRunActivity,
  validateRunStatusTransition,
} from "@/lib/db/queries";

const VALID_STATUSES = ["running", "waiting", "pending", "done", "failed", "skipped", "killed"];

export const PUT = withAuth(async (req, auth, { params }) => {
  const { id } = await params;
  const run = getRunById(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const ownerError = requireAgentOwnership(auth, run.agent_id);
  if (ownerError) return ownerError;

  const body = await req.json();
  if (!body.status || !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }

  const validationError = validateRunStatusTransition(id, body.status);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 409 });
  }

  const updated = updateRunStatus(id, body.status);

  addRunActivity(id, "system", null, "System", `Status changed to **${body.status}**`);

  return NextResponse.json(updated);
});
