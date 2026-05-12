import { NextResponse } from "next/server";
import { withAuth, withUserAuth, getActorFromAuth } from "@/lib/auth";
import {
  listInspirationPosts,
  bulkCreateInspirationPosts,
  setInspirationRun,
  linkInspirationToProject,
  findInspirationByUrl,
  type InspirationStatus,
} from "@/lib/db/queries";
import { triggerJobRun } from "@/lib/db/queries";
import { ensureInspirationsProcessor } from "@/lib/inspirations/ensure-processor";

function normalizeLinkedInUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
    // Strip tracking params but keep the path/identifier
    const cleaned = new URL(u.origin + u.pathname);
    return cleaned.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export const GET = withAuth(async (req) => {
  const url = req.nextUrl;
  const status = url.searchParams.get("status") as InspirationStatus | null;
  const projectId = url.searchParams.get("projectId") || undefined;
  const limit = Number(url.searchParams.get("limit")) || undefined;
  const offset = Number(url.searchParams.get("offset")) || undefined;

  const rows = listInspirationPosts({
    status: status || undefined,
    projectId,
    limit,
    offset,
  });
  return NextResponse.json({ inspirations: rows });
});

export const POST = withUserAuth(async (req, auth) => {
  const body = await req.json().catch(() => null);
  const urlsInput: unknown = body?.urls;
  const projectId: string | undefined = typeof body?.projectId === "string" ? body.projectId : undefined;

  if (!Array.isArray(urlsInput) || urlsInput.length === 0) {
    return NextResponse.json({ error: "urls must be a non-empty array" }, { status: 400 });
  }

  const normalized: string[] = [];
  const rejected: { input: string; reason: string }[] = [];
  for (const raw of urlsInput) {
    if (typeof raw !== "string") {
      rejected.push({ input: String(raw), reason: "not a string" });
      continue;
    }
    const n = normalizeLinkedInUrl(raw);
    if (!n) {
      rejected.push({ input: raw, reason: "not a linkedin.com URL" });
      continue;
    }
    normalized.push(n);
  }

  // Dedupe within the batch
  const unique = Array.from(new Set(normalized));

  // Skip URLs that have an in-flight or completed row
  const toCreate: string[] = [];
  const skipped: { url: string; reason: string }[] = [];
  for (const u of unique) {
    const existing = findInspirationByUrl(u);
    if (existing && (existing.status === "queued" || existing.status === "processing")) {
      skipped.push({ url: u, reason: "already in queue" });
      continue;
    }
    toCreate.push(u);
  }

  if (toCreate.length === 0) {
    return NextResponse.json({ created: [], skipped, rejected }, { status: 200 });
  }

  const { actorType, actorId } = getActorFromAuth(auth);

  // Auto-provision the processor agent + job before queuing runs
  const origin = req.headers.get("origin") || `http://localhost:${process.env.PORT || 3000}`;
  const processor = ensureInspirationsProcessor(origin);

  const created = bulkCreateInspirationPosts(toCreate, actorType, actorId);

  // Queue a run per inspiration with the URL + id embedded in extra_instructions
  for (const row of created) {
    const run = triggerJobRun(
      processor.jobId,
      JSON.stringify({ inspiration_post_id: row.id, url: row.url }),
    );
    if (run) setInspirationRun(row.id, run.runId);
    if (projectId) linkInspirationToProject(projectId, row.id);
  }

  return NextResponse.json({ created, skipped, rejected, processor_created: processor.created }, { status: 201 });
});
