import { NextRequest, NextResponse } from "next/server";
import { withAuth, withUserAuth } from "@/lib/auth";
import { listAllJobs, createJob } from "@/lib/db/queries";
import { isValidSchedule } from "@/lib/schedule";

export const GET = withAuth(async (req) => {
  const projectId = req.nextUrl.searchParams.get("projectId") || undefined;
  return NextResponse.json(listAllJobs(projectId));
});

// Create an agentless workflow-only job
export const POST = withUserAuth(async (req) => {
  const body = await req.json();
  const { name, description, schedule, workflowCommand, docIds, envVarIds, triggerKind, watchedStageId } = body;
  if (!name || !schedule || !workflowCommand) {
    return NextResponse.json({ error: "name, schedule, and workflowCommand are required" }, { status: 400 });
  }
  if (!isValidSchedule(schedule)) {
    return NextResponse.json({ error: "Invalid schedule format. Use {\"every\":N} for intervals or {\"days\":[0-6],\"time\":\"HH:MM\"} for weekly." }, { status: 400 });
  }
  const job = createJob(null, {
    name,
    description,
    schedule,
    workflowCommand,
    workflowOnly: true,
    docIds,
    envVarIds,
    triggerKind,
    watchedStageId,
  });
  return NextResponse.json(job, { status: 201 });
});
