import { NextRequest, NextResponse } from "next/server";
import { withAuth, requireAgentOwnership } from "@/lib/auth";
import { getAgentById, touchAgentPolled, getAgentNextRun, peekAgentNext, RunAttachment, getProcessingByAttachment } from "@/lib/db/queries";
import { serializeAttachment, SerializedAttachment } from "@/lib/attachments-serialize";
import { publicBaseUrl } from "@/lib/request-url";
import { isVideoFile, readTranscript, readStoryboard, TRANSCRIPT_CAP } from "@/lib/video-processing";

function buildApiSection(req: NextRequest, runId: string, taskId: string | null) {
  const base = publicBaseUrl(req);
  const endpoints: Record<string, string> = {
    update_status: `PUT ${base}/api/runs/${runId}/status`,
    post_activity: `POST ${base}/api/runs/${runId}/activity`,
    upload_attachment: `POST ${base}/api/runs/${runId}/attachments`,
    create_doc: `POST ${base}/api/docs`,
    update_doc: `PUT ${base}/api/docs/:id`,
    create_database: `POST ${base}/api/databases`,
    insert_rows: `POST ${base}/api/databases/:id/rows`,
    read_rows: `GET ${base}/api/databases/:id/rows`,
    guide: `GET ${base}/api/guide`,
  };

  const notes = [
    "You MUST set a final status (done/failed) when finished, or waiting if you need human input.",
    "Post activity messages to log progress — these are visible on the dashboard.",
    "Attachments belong to the run thread — files (multipart) or video URL embeds (JSON {url}).",
    "Full API spec available at the guide endpoint.",
  ];

  if (taskId) {
    endpoints.move_task_stage = `PUT ${base}/api/tasks/${taskId}/stage`;
    endpoints.post_task_activity = `POST ${base}/api/tasks/${taskId}/activity`;
    notes.push(
      "This run is bound to a task (see the `task` field). Read the task's prior activity log — it includes feedback from previous runs.",
      "You MUST move the task to a new stage (using move_task_stage with one of the legal_transitions ids) before setting status='done'. Otherwise mark the run as 'failed' with an explanation.",
      "When moving a task, optionally include a `comment` in the body to leave a note explaining the move (e.g. why you kicked it back).",
    );
  }

  return {
    base_url: base,
    endpoints,
    status_options: ["done", "failed", "waiting"],
    notes,
  };
}

export const GET = withAuth(async (req, auth, { params }) => {
  const { id } = await params;
  const ownerError = requireAgentOwnership(auth, id);
  if (ownerError) return ownerError;

  const existing = getAgentById(id);
  if (!existing) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  touchAgentPolled(id);

  const peek = req.nextUrl.searchParams.get("peek") === "true";
  if (peek) {
    const result = peekAgentNext(id);
    return NextResponse.json(result);
  }

  const payload = getAgentNextRun(id);
  if (!payload) {
    return NextResponse.json(null);
  }

  const base = publicBaseUrl(req);
  const serialized = (payload.attachments as RunAttachment[]).map(a => serializeAttachment(a, base));

  const enriched = serialized.map((att: SerializedAttachment) => {
    if (!isVideoFile(att.mime_type, att.filename)) return att;
    const proc = getProcessingByAttachment(att.id);
    if (!proc) return att;

    const processing: Record<string, unknown> = {
      status: proc.status,
      screenshot_count: proc.screenshot_count,
      screenshots_url: `${base}/api/runs/${payload.run.id}/attachments/${att.id}/screenshots`,
      duration_seconds: proc.duration_seconds,
    };

    if (proc.status === "done") {
      // Prefer storyboard (interleaved screenshots + transcript) over plain transcript
      if (proc.screenshots_dir) {
        const storyboard = readStoryboard(proc.screenshots_dir, base, TRANSCRIPT_CAP);
        if (storyboard) {
          processing.storyboard = storyboard;
        }
      }
      if (proc.transcript_path) {
        processing.transcript = readTranscript(proc.transcript_path, TRANSCRIPT_CAP);
        processing.transcript_url = `${base}/api/runs/${payload.run.id}/attachments/${att.id}/transcript`;
      }
    }

    return { ...att, processing };
  });

  return NextResponse.json({
    ...payload,
    attachments: enriched,
    api: buildApiSection(req, payload.run.id, payload.run.task_id ?? null),
  });
});
