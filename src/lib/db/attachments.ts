import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { getDb } from "./schema";
import { uploadsDir, parentUploadsDir } from "../paths";

export type AttachmentKind = "file" | "embed";

export type ParentType = "run" | "task";

export type Parent = { type: ParentType; id: string };

/**
 * An attachment row. Polymorphic via run_id and task_id — exactly one is set.
 * The legacy `run_id` field is preserved for backward compatibility with any
 * code that hasn't yet migrated to the parent abstraction.
 */
export type Attachment = {
  id: string;
  run_id: string | null;
  task_id: string | null;
  activity_id: string | null;
  kind: AttachmentKind;
  filename: string | null;
  storage_path: string | null; // relative to uploadsDir()
  mime_type: string | null;
  size_bytes: number | null;
  url: string | null;
  embed_provider: string | null;
  title: string | null;
  uploaded_by_type: "user" | "agent" | null;
  uploaded_by_id: string | null;
  uploaded_by_name: string | null;
  created_at: number;
};

/** Backward-compat alias: code that previously imported RunAttachment still works. */
export type RunAttachment = Attachment;

export type Uploader = {
  type: "user" | "agent";
  id: string | null;
  name: string;
};

/**
 * Detect a video embed provider from a URL.
 * Returns null for URLs we don't render as iframes.
 */
export function detectEmbedProvider(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") return "youtube";
    if (host === "loom.com" || host.endsWith(".loom.com")) return "loom";
    if (host === "vimeo.com" || host.endsWith(".vimeo.com")) return "vimeo";
    return "generic";
  } catch {
    return null;
  }
}

function parentColumns(parent: Parent): { run_id: string | null; task_id: string | null } {
  return parent.type === "run"
    ? { run_id: parent.id, task_id: null }
    : { run_id: null, task_id: parent.id };
}

export function createFileAttachment(params: {
  parent: Parent;
  filename: string;
  storagePath: string; // relative to uploadsDir()
  mimeType: string;
  sizeBytes: number;
  uploader: Uploader;
  title?: string | null;
}): Attachment {
  const db = getDb();
  const id = uuid();
  const { run_id, task_id } = parentColumns(params.parent);
  db.prepare(`
    INSERT INTO attachments
      (id, run_id, task_id, kind, filename, storage_path, mime_type, size_bytes, title,
       uploaded_by_type, uploaded_by_id, uploaded_by_name)
    VALUES (?, ?, ?, 'file', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    run_id,
    task_id,
    params.filename,
    params.storagePath,
    params.mimeType,
    params.sizeBytes,
    params.title ?? null,
    params.uploader.type,
    params.uploader.id,
    params.uploader.name,
  );
  return getAttachmentById(id)!;
}

export function createEmbedAttachment(params: {
  parent: Parent;
  url: string;
  uploader: Uploader;
  title?: string | null;
}): Attachment {
  const db = getDb();
  const provider = detectEmbedProvider(params.url);
  if (!provider) throw new Error("Invalid embed URL");
  const id = uuid();
  const { run_id, task_id } = parentColumns(params.parent);
  db.prepare(`
    INSERT INTO attachments
      (id, run_id, task_id, kind, url, embed_provider, title,
       uploaded_by_type, uploaded_by_id, uploaded_by_name)
    VALUES (?, ?, ?, 'embed', ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    run_id,
    task_id,
    params.url,
    provider,
    params.title ?? null,
    params.uploader.type,
    params.uploader.id,
    params.uploader.name,
  );
  return getAttachmentById(id)!;
}

export function getAttachmentById(id: string): Attachment | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM attachments WHERE id = ?`).get(id) as Attachment | undefined;
  return row || null;
}

/** List attachments for a parent (run or task), oldest first. */
export function listAttachmentsByParent(parent: Parent): Attachment[] {
  const db = getDb();
  const col = parent.type === "run" ? "run_id" : "task_id";
  return db.prepare(
    `SELECT * FROM attachments WHERE ${col} = ? ORDER BY created_at ASC`
  ).all(parent.id) as Attachment[];
}

/** Convenience: list attachments for a run. Backward-compat shim. */
export function listAttachmentsByRun(runId: string): Attachment[] {
  return listAttachmentsByParent({ type: "run", id: runId });
}

/** List attachments belonging to a task. */
export function listAttachmentsByTask(taskId: string): Attachment[] {
  return listAttachmentsByParent({ type: "task", id: taskId });
}

/**
 * Link a set of attachments (by id) to a newly-created run activity entry.
 * Used when a comment is posted with previously-uploaded attachments. Only
 * applies to run-scoped attachments.
 */
export function linkAttachmentsToActivity(attachmentIds: string[], activityId: string, runId: string): void {
  if (!attachmentIds.length) return;
  const db = getDb();
  const placeholders = attachmentIds.map(() => "?").join(",");
  db.prepare(
    `UPDATE attachments SET activity_id = ? WHERE run_id = ? AND id IN (${placeholders}) AND activity_id IS NULL`
  ).run(activityId, runId, ...attachmentIds);
}

/**
 * Delete an attachment row + its on-disk file (if any).
 */
export function deleteAttachment(id: string): boolean {
  const db = getDb();
  const att = getAttachmentById(id);
  if (!att) return false;
  if (att.kind === "file" && att.storage_path) {
    const abs = path.join(uploadsDir(), att.storage_path);
    try { fs.unlinkSync(abs); } catch { /* file already gone — ignore */ }
  }
  db.prepare(`DELETE FROM attachments WHERE id = ?`).run(id);
  return true;
}

/**
 * Remove the on-disk directory for a parent's attachments. The DB rows
 * cascade-delete via the FK; this just cleans up the filesystem side.
 */
export function deleteParentAttachmentsDir(parent: Parent): void {
  const dir = parentUploadsDir(parent.type, parent.id);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/** Backward-compat shim for existing run delete paths. */
export function deleteRunAttachmentsDir(runId: string): void {
  deleteParentAttachmentsDir({ type: "run", id: runId });
}
