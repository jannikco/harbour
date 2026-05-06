import { Attachment } from "./db/attachments";

/**
 * Serialize an Attachment for the wire. Hides on-disk storage_path,
 * adds an absolute download URL (for file kind) keyed off the parent type,
 * and exposes the parent identity so clients can render it consistently.
 */
export type SerializedAttachment = {
  id: string;
  parent_type: "run" | "task";
  parent_id: string;
  /** @deprecated prefer parent_type/parent_id; kept for back-compat with run consumers. */
  run_id: string | null;
  task_id: string | null;
  activity_id: string | null;
  kind: "file" | "embed";
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  url: string | null; // file: download URL; embed: source URL
  embed_provider: string | null;
  title: string | null;
  uploaded_by_type: "user" | "agent" | null;
  uploaded_by_name: string | null;
  created_at: number;
};

export function serializeAttachment(att: Attachment, baseUrl: string): SerializedAttachment {
  const parent_type: "run" | "task" = att.run_id ? "run" : "task";
  const parent_id = (att.run_id || att.task_id)!;
  const url = att.kind === "file"
    ? `${baseUrl}/api/${parent_type === "run" ? "runs" : "tasks"}/${parent_id}/attachments/${att.id}/file`
    : att.url;
  return {
    id: att.id,
    parent_type,
    parent_id,
    run_id: att.run_id,
    task_id: att.task_id,
    activity_id: att.activity_id,
    kind: att.kind,
    filename: att.filename,
    mime_type: att.mime_type,
    size_bytes: att.size_bytes,
    url,
    embed_provider: att.embed_provider,
    title: att.title,
    uploaded_by_type: att.uploaded_by_type,
    uploaded_by_name: att.uploaded_by_name,
    created_at: att.created_at,
  };
}
