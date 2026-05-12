import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { spawnNodeScript } from "@/lib/linkedin-process";
import { importDmsJsonl } from "@/lib/dms-db";
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Job = { startedAt: number; status: "running" | "done" | "error"; result?: unknown; error?: string };
const g = globalThis as unknown as { __dmScrapeJob?: Job };

function scriptPath() {
  return join(homedir(), ".harbour", "workflows", "linkedin-scrape-dms.mjs");
}
function outPath() {
  const dir = join(homedir(), ".harbour", "state", "scrapes");
  mkdirSync(dir, { recursive: true });
  return join(dir, `dms-${Date.now()}.jsonl`);
}

async function readEnvVarValue(name: string): Promise<string | null> {
  const mod = await import("@/lib/db/schema");
  const db = mod.getDb();
  const row = db
    .prepare(`SELECT encrypted_value FROM env_vars WHERE name = ?`)
    .get(name) as { encrypted_value: string } | undefined;
  if (!row) return null;
  const enc = await import("@/lib/encryption");
  try { return enc.decrypt(row.encrypted_value); } catch { return null; }
}

function handleFromUrl(u: string | null): string | null {
  if (!u) return null;
  const m = u.match(/\/in\/([^/?#]+)/);
  return m ? m[1] : null;
}

export const POST = withAuth(async (req) => {
  if (g.__dmScrapeJob && g.__dmScrapeJob.status === "running") {
    return NextResponse.json(
      { ok: false, status: "already-running", startedAt: g.__dmScrapeJob.startedAt },
      { status: 409 }
    );
  }

  let maxConv = 20;
  try {
    const body = await req.json();
    if (typeof body?.max === "number" && body.max > 0) maxConv = Math.min(100, body.max);
  } catch {}

  const profileUrl = await readEnvVarValue("LINKEDIN_PROFILE_URL");
  const myHandle = handleFromUrl(profileUrl) || "";

  const script = scriptPath();
  if (!existsSync(script)) return NextResponse.json({ error: "script missing" }, { status: 500 });
  const out = outPath();

  const job: Job = { startedAt: Date.now(), status: "running" };
  g.__dmScrapeJob = job;

  const child = spawnNodeScript(script, [out, String(maxConv), myHandle]);
  let stderr = "";
  child.stderr?.on("data", (d) => (stderr += d.toString()));
  child.on("exit", (code) => {
    if (code !== 0) {
      job.status = "error";
      job.error = stderr.slice(-600) || `exit ${code}`;
      return;
    }
    try {
      const result = importDmsJsonl(out);
      job.status = "done";
      job.result = { ...result, jsonl: out };
    } catch (err) {
      job.status = "error";
      job.error = String(err);
    }
  });

  return NextResponse.json({ ok: true, status: "running", startedAt: job.startedAt }, { status: 202 });
});

export const GET = withAuth(async () => {
  if (!g.__dmScrapeJob) return NextResponse.json({ status: "idle" });
  return NextResponse.json(g.__dmScrapeJob);
});
