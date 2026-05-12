import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { homedir } from "os";
import { join } from "path";
import { existsSync, statSync, unlinkSync } from "fs";
import { spawnNodeScript } from "@/lib/linkedin-process";
import type { ChildProcess } from "child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConnectState = {
  proc: ChildProcess;
  startedAt: number;
  status: "running" | "saved" | "error";
  error?: string;
  exitCode?: number | null;
};

// Module-level: survives across requests in production.
const g = globalThis as unknown as { __linkedinConnect?: ConnectState };

function statePath() {
  return join(homedir(), ".harbour/state/linkedin-storage.json");
}

function workflowPath() {
  return join(homedir(), ".harbour/workflows/linkedin-setup-auto.mjs");
}

export const GET = withAuth(async () => {
  const active = g.__linkedinConnect;
  if (active && active.status === "running") {
    return NextResponse.json({
      status: "running",
      startedAt: active.startedAt,
    });
  }
  if (active && active.status === "error") {
    return NextResponse.json({
      status: "error",
      error: active.error,
      exitCode: active.exitCode,
    });
  }
  // No active proc — check the saved state file.
  const sp = statePath();
  if (existsSync(sp)) {
    const st = statSync(sp);
    return NextResponse.json({
      status: "connected",
      savedAt: st.mtimeMs,
      sizeBytes: st.size,
    });
  }
  return NextResponse.json({ status: "disconnected" });
});

export const POST = withAuth(async () => {
  const active = g.__linkedinConnect;
  if (active && active.status === "running") {
    return NextResponse.json(
      { error: "Connect already in progress" },
      { status: 409 }
    );
  }

  const script = workflowPath();
  if (!existsSync(script)) {
    return NextResponse.json(
      { error: `Setup script missing at ${script}` },
      { status: 500 }
    );
  }

  const child = spawnNodeScript(script, [statePath()], { HOME: homedir() });

  let stderr = "";
  child.stdout?.on("data", (d) => {
    // best-effort logging; not surfaced to UI
    console.log("[linkedin-connect]", d.toString().trim());
  });
  child.stderr?.on("data", (d) => {
    stderr += d.toString();
  });

  const entry: ConnectState = {
    proc: child,
    startedAt: Date.now(),
    status: "running",
  };
  g.__linkedinConnect = entry;

  child.on("exit", (code) => {
    entry.exitCode = code;
    if (code === 0) entry.status = "saved";
    else {
      entry.status = "error";
      entry.error = stderr.trim().slice(-800) || `exit code ${code}`;
    }
  });

  return NextResponse.json({ status: "running", startedAt: entry.startedAt }, { status: 202 });
});

export const DELETE = withAuth(async () => {
  const active = g.__linkedinConnect;
  if (active && active.status === "running") {
    try {
      active.proc.kill("SIGTERM");
    } catch {}
    g.__linkedinConnect = undefined;
    return NextResponse.json({ ok: true, action: "cancelled" });
  }
  // Otherwise: forget the saved-state-on-disk too (disconnect).
  const sp = statePath();
  if (existsSync(sp)) {
    try {
      unlinkSync(sp);
      return NextResponse.json({ ok: true, action: "disconnected" });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true, action: "noop" });
});
