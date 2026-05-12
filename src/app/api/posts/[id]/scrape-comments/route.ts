import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { spawnNodeScript } from "@/lib/linkedin-process";
import { importCommentsJsonl, listPosts } from "@/lib/posts-db";
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Job = { startedAt: number; status: "running" | "done" | "error"; result?: unknown; error?: string };
const g = globalThis as unknown as { __postScrapeJobs?: Map<number, Job> };
g.__postScrapeJobs ??= new Map();

function scriptPath() {
  return join(homedir(), ".harbour", "workflows", "linkedin-scrape-post-comments.mjs");
}
function outPath(postId: string) {
  const dir = join(homedir(), ".harbour", "state", "scrapes");
  mkdirSync(dir, { recursive: true });
  return join(dir, `comments-${postId}-${Date.now()}.jsonl`);
}

async function readEnvVarValue(name: string): Promise<string | null> {
  const mod = await import("@/lib/db/schema");
  const db = mod.getDb();
  const row = db.prepare(`SELECT encrypted_value FROM env_vars WHERE name = ?`).get(name) as
    | { encrypted_value: string }
    | undefined;
  if (!row) return null;
  const enc = await import("@/lib/encryption");
  try { return enc.decrypt(row.encrypted_value); } catch { return null; }
}

function handleFromUrl(u: string | null): string | null {
  if (!u) return null;
  const m = u.match(/\/in\/([^/?#]+)/);
  return m ? m[1] : null;
}

export const POST = withAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  const dbId = parseInt(id, 10);
  if (!Number.isFinite(dbId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  // Find the post row
  const post = listPosts().find((p) => p.id === dbId);
  if (!post) return NextResponse.json({ error: "post not found" }, { status: 404 });

  const profileUrl = await readEnvVarValue("LINKEDIN_PROFILE_URL");
  const myHandle = handleFromUrl(profileUrl) || "";

  const script = scriptPath();
  if (!existsSync(script)) return NextResponse.json({ error: `script missing: ${script}` }, { status: 500 });

  const out = outPath(post.linkedin_post_id);
  const existing = g.__postScrapeJobs!.get(dbId);
  if (existing && existing.status === "running") {
    return NextResponse.json({ ok: false, status: "already-running", startedAt: existing.startedAt }, { status: 409 });
  }
  const job: Job = { startedAt: Date.now(), status: "running" };
  g.__postScrapeJobs!.set(dbId, job);

  const child = spawnNodeScript(script, [post.linkedin_post_id, out, myHandle]);
  let stderr = "";
  child.stderr?.on("data", (d) => (stderr += d.toString()));
  child.on("exit", (code) => {
    if (code !== 0) {
      job.status = "error";
      job.error = stderr.slice(-600) || `exit ${code}`;
      return;
    }
    try {
      const result = importCommentsJsonl(out, post.post_url, myHandle || null);
      job.status = "done";
      job.result = { ...result, jsonl: out };
    } catch (err) {
      job.status = "error";
      job.error = String(err);
    }
  });

  return NextResponse.json({ ok: true, status: "running", startedAt: job.startedAt }, { status: 202 });
});

export const GET = withAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  const dbId = parseInt(id, 10);
  if (!Number.isFinite(dbId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const job = g.__postScrapeJobs!.get(dbId);
  if (!job) return NextResponse.json({ status: "idle" });
  return NextResponse.json(job);
});
