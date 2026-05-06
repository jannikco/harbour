/**
 * Browser-side upload helper. Uses XMLHttpRequest so we can report
 * progress — the Fetch API does not expose upload progress events.
 *
 * Polymorphic over the attachment parent (run or task) — the URL is built
 * from the parent shape so both kinds share the same wire protocol.
 */

import type { SerializedAttachment } from "./attachments-serialize";

export type UploadProgress = (pct: number) => void;

export type UploadHandle = {
  promise: Promise<SerializedAttachment>;
  abort: () => void;
};

export type UploadParent = { type: "run" | "task"; id: string };

function attachmentsUrlFor(parent: UploadParent): string {
  return parent.type === "run"
    ? `/api/runs/${parent.id}/attachments`
    : `/api/tasks/${parent.id}/attachments`;
}

export function uploadFile(parent: UploadParent, file: File, onProgress?: UploadProgress): UploadHandle {
  const xhr = new XMLHttpRequest();
  const form = new FormData();
  form.append("file", file);

  const promise = new Promise<SerializedAttachment>((resolve, reject) => {
    xhr.open("POST", attachmentsUrlFor(parent), true);

    xhr.upload.onprogress = e => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const arr = JSON.parse(xhr.responseText);
          resolve(arr[0]);
        } catch (err) {
          reject(err);
        }
      } else {
        let message = `Upload failed (${xhr.status})`;
        try { message = JSON.parse(xhr.responseText).error || message; } catch { /* ignore */ }
        reject(new Error(message));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload aborted"));

    xhr.send(form);
  });

  return { promise, abort: () => xhr.abort() };
}

/** Backward-compat shim: code still using uploadFileToRun continues to work. */
export function uploadFileToRun(runId: string, file: File, onProgress?: UploadProgress): UploadHandle {
  return uploadFile({ type: "run", id: runId }, file, onProgress);
}

export async function createEmbedAttachment(parent: UploadParent, url: string, title?: string): Promise<SerializedAttachment> {
  const res = await fetch(attachmentsUrlFor(parent), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, title }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed" }));
    throw new Error(err.error || "Failed to add embed");
  }
  return res.json();
}

export async function deleteAttachment(parent: UploadParent, attachmentId: string): Promise<void> {
  const url = parent.type === "run"
    ? `/api/runs/${parent.id}/attachments/${attachmentId}`
    : `/api/tasks/${parent.id}/attachments/${attachmentId}`;
  await fetch(url, { method: "DELETE" });
}

/** Match URLs we support embedding. Must stay in sync with server-side detectEmbedProvider. */
export function detectEmbedProvider(url: string): "youtube" | "loom" | "vimeo" | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") return "youtube";
    if (host === "loom.com" || host.endsWith(".loom.com")) return "loom";
    if (host === "vimeo.com" || host.endsWith(".vimeo.com")) return "vimeo";
    return null;
  } catch {
    return null;
  }
}
