import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { spawnNodeScript } from "@/lib/linkedin-process";
import { pickEnrichTargets, importEnrichmentJsonl } from "@/lib/posts-db";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Job = { startedAt: number; status: "running" | "done" | "error"; batch: number; result?: unknown; error?: string };
const g = globalThis as unknown as { __enrichJob?: Job };

function scriptPath() {
  return join(homedir(), ".harbour", "workflows", "linkedin-enrich-profiles.mjs");
}
function paths(stamp: number) {
  const dir = join(homedir(), ".harbour", "state", "scrapes");
  mkdirSync(dir, { recursive: true });
  return {
    input: join(dir, `enrich-input-${stamp}.jsonl`),
    output: join(dir, `enrich-output-${stamp}.jsonl`),
  };
}

export const POST = withAuth(async (req) => {
  let batch = 20;
  try {
    const body = await req.json();
    if (typeof body?.batch === "number" && body.batch > 0) batch = Math.min(200, body.batch);
  } catch {}

  if (g.__enrichJob && g.__enrichJob.status === "running") {
    return NextResponse.json({ ok: false, status: "already-running", startedAt: g.__enrichJob.startedAt }, { status: 409 });
  }

  const targets = pickEnrichTargets(batch);
  if (targets.length === 0) {
    return NextResponse.json({ ok: true, status: "no-targets", picked: 0 });
  }

  const stamp = Date.now();
  const { input, output } = paths(stamp);
  writeFileSync(input, targets.map((t) => JSON.stringify(t)).join("\n") + "\n");

  const script = scriptPath();
  if (!existsSync(script)) return NextResponse.json({ error: "script missing" }, { status: 500 });

  const job: Job = { startedAt: stamp, status: "running", batch: targets.length };
  g.__enrichJob = job;

  const child = spawnNodeScript(script, [input, output], { ENRICH_BATCH: String(batch) });
  let stderr = "";
  child.stderr?.on("data", (d) => (stderr += d.toString()));
  child.on("exit", (code) => {
    if (code !== 0 && code !== 5 /* halted */) {
      job.status = "error";
      job.error = stderr.slice(-600) || `exit ${code}`;
      return;
    }
    try {
      const result = importEnrichmentJsonl(output);
      job.status = "done";
      job.result = { ...result, exitCode: code, jsonl: output };
    } catch (err) {
      job.status = "error";
      job.error = String(err);
    }
  });

  return NextResponse.json({ ok: true, status: "running", picked: targets.length, startedAt: stamp }, { status: 202 });
});

export const GET = withAuth(async () => {
  if (!g.__enrichJob) return NextResponse.json({ status: "idle" });
  return NextResponse.json(g.__enrichJob);
});
