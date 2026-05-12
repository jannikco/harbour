import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function workflowPath() {
  return join(homedir(), ".harbour", "workflows", "linkedin-sync-connections.sh");
}

export const POST = withAuth(async () => {
  // Phase B.3 will provide the Playwright script.
  if (!existsSync(workflowPath())) {
    return NextResponse.json(
      {
        ok: false,
        status: "not-built",
        message:
          "Connections sync workflow not built yet (Phase B.3). Cap settings will be enforced once Playwright workflows exist.",
      },
      { status: 501 }
    );
  }

  // Defer the actual spawn-and-stream to Phase B.3 when we have the script.
  return NextResponse.json({
    ok: false,
    status: "not-implemented",
    message: "Phase B.3 spawn wiring not yet hooked up.",
  });
});
