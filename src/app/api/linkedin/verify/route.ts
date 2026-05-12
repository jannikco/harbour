import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { homedir } from "os";
import { join } from "path";
import { existsSync } from "fs";
import { spawnNodeScript } from "@/lib/linkedin-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function scriptPath() {
  return join(homedir(), ".harbour/workflows/linkedin-verify-session.mjs");
}

function statePath() {
  return join(homedir(), ".harbour/state/linkedin-storage.json");
}

export const POST = withAuth(async () => {
  const script = scriptPath();
  const state = statePath();

  if (!existsSync(state)) {
    return NextResponse.json(
      { ok: false, error: "No saved session. Connect first." },
      { status: 400 }
    );
  }
  if (!existsSync(script)) {
    return NextResponse.json(
      { ok: false, error: `Verify script missing at ${script}` },
      { status: 500 }
    );
  }

  return new Promise<Response>((resolve) => {
    const child = spawnNodeScript(script, [state], { HOME: homedir() });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));

    // 30-second cap.
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
    }, 30_000);

    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        // Parse "User: <name>" if present
        const nameMatch = stdout.match(/User:\s*(.+)/);
        const urlMatch = stdout.match(/URL:\s*(\S+)/);
        resolve(
          NextResponse.json({
            ok: true,
            name: nameMatch?.[1] ?? null,
            url: urlMatch?.[1] ?? null,
            raw: stdout.trim(),
          })
        );
      } else {
        resolve(
          NextResponse.json(
            {
              ok: false,
              exitCode: code,
              error: stderr.trim() || stdout.trim() || `exit ${code}`,
            },
            { status: 502 }
          )
        );
      }
    });
  });
});
