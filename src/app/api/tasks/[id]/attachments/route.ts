import { NextResponse } from "next/server";
import { withAuth, requireTaskClaim, AuthContext } from "@/lib/auth";
import {
  getTaskById,
  listAttachmentsByTask,
  createFileAttachment,
  createEmbedAttachment,
  detectEmbedProvider,
  hasActiveTaskClaim,
  Attachment,
  Uploader,
} from "@/lib/db/queries";
import { receiveMultipartUploads, UploadError } from "@/lib/upload";
import { serializeAttachment } from "@/lib/attachments-serialize";
import { publicBaseUrl } from "@/lib/request-url";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function uploaderFromAuth(auth: AuthContext): Uploader {
  return auth.type === "user"
    ? { type: "user", id: auth.userId, name: auth.displayName }
    : { type: "agent", id: auth.agentId, name: auth.agentName };
}

export const GET = withAuth(async (req, _auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  const task = getTaskById(id);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  const rows = listAttachmentsByTask(id);
  const base = publicBaseUrl(req);
  return NextResponse.json(rows.map(r => serializeAttachment(r, base)));
});

export const POST = withAuth(async (req, auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  const task = getTaskById(id);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  // Agents may only attach to tasks they currently have claimed; users always pass.
  const claimError = requireTaskClaim(auth, id, hasActiveTaskClaim);
  if (claimError) return claimError;

  const contentType = req.headers.get("content-type") || "";
  const uploader = uploaderFromAuth(auth);
  const base = publicBaseUrl(req);

  // Embed (URL) — JSON body
  if (contentType.toLowerCase().startsWith("application/json")) {
    let body: { url?: string; title?: string };
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    if (!body.url) return NextResponse.json({ error: "url is required" }, { status: 400 });
    if (!detectEmbedProvider(body.url)) {
      return NextResponse.json({ error: "Invalid embed URL" }, { status: 400 });
    }
    const att = createEmbedAttachment({ parent: { type: "task", id }, url: body.url, title: body.title ?? null, uploader });
    return NextResponse.json(serializeAttachment(att, base), { status: 201 });
  }

  // File upload — multipart/form-data
  try {
    const { files } = await receiveMultipartUploads(req, { type: "task", id });
    const created: Attachment[] = files.map(f => createFileAttachment({
      parent: { type: "task", id },
      filename: f.filename,
      storagePath: f.storagePath,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      uploader,
    }));
    return NextResponse.json(created.map(r => serializeAttachment(r, base)), { status: 201 });
  } catch (err) {
    if (err instanceof UploadError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[task attachments POST] upload failed:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
});
