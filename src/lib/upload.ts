import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import Busboy from "busboy";
import { v4 as uuid } from "uuid";
import { NextRequest } from "next/server";
import { ensureDir, maxUploadBytes, parentUploadsDir, uploadsDir } from "./paths";

/**
 * Sanitize an uploaded filename. Keep the extension, strip path separators,
 * replace anything that isn't [a-z0-9._-] with underscores, and truncate.
 */
export function sanitizeFilename(input: string): string {
  const base = path.basename(input || "file");
  const ext = path.extname(base).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 16);
  const stem = base.slice(0, base.length - path.extname(base).length)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.]+|[_.]+$/g, "")
    .slice(0, 80) || "file";
  return stem + ext;
}

export type StagedUpload = {
  filename: string;      // original filename (sanitized)
  mimeType: string;
  sizeBytes: number;
  storagePath: string;   // relative to uploadsDir()
};

export type UploadParent = { type: "run" | "task"; id: string };

/**
 * Stream a multipart/form-data request into the parent's upload directory.
 *
 * Writes each file to a temp path first, then atomically renames into
 * place. On any error (size cap, stream fault), cleans up all temp files
 * before throwing.
 *
 * Enforces maxUploadBytes() per file.
 *
 * Returns staged file info + any non-file form fields.
 */
export async function receiveMultipartUploads(
  req: NextRequest,
  parent: UploadParent,
): Promise<{ files: StagedUpload[]; fields: Record<string, string> }> {
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    throw new UploadError("Expected multipart/form-data", 400);
  }
  if (!req.body) {
    throw new UploadError("Empty request body", 400);
  }

  const destDir = parentUploadsDir(parent.type, parent.id);
  ensureDir(destDir);
  const limit = maxUploadBytes();

  const staged: StagedUpload[] = [];
  const tempPaths: string[] = [];
  const fields: Record<string, string> = {};
  const filePromises: Promise<void>[] = [];
  let firstError: Error | null = null;

  // Web ReadableStream → Node Readable for busboy
  const nodeStream = Readable.fromWeb(req.body as unknown as Parameters<typeof Readable.fromWeb>[0]);

  const bb = Busboy({
    headers: { "content-type": contentType },
    limits: { fileSize: limit },
  });

  const parserDone = new Promise<void>((resolve, reject) => {
    bb.on("file", (_fieldname, fileStream, info) => {
      const origName = sanitizeFilename(info.filename || "file");
      const storageName = `${uuid()}__${origName}`;
      const tempPath = path.join(destDir, `.${storageName}.tmp`);
      tempPaths.push(tempPath);

      const ws = fs.createWriteStream(tempPath);
      let size = 0;
      let exceeded = false;

      fileStream.on("data", chunk => { size += chunk.length; });

      fileStream.on("limit", () => {
        exceeded = true;
        if (!firstError) firstError = new UploadError(
          `File exceeds max upload size of ${Math.round(limit / 1024 / 1024)} MB`,
          413,
        );
      });

      filePromises.push(
        pipeline(fileStream, ws).then(() => {
          if (exceeded) return;
          staged.push({
            filename: origName,
            mimeType: info.mimeType || "application/octet-stream",
            sizeBytes: size,
            storagePath: path.relative(uploadsDir(), path.join(destDir, storageName)),
          });
        }).catch(err => {
          if (!firstError) firstError = err as Error;
        }),
      );
    });

    bb.on("field", (name, val) => {
      if (typeof val === "string") fields[name] = val;
    });

    bb.on("error", err => {
      if (!firstError) firstError = err as Error;
      reject(firstError);
    });

    bb.on("close", () => resolve());
  });

  try {
    nodeStream.pipe(bb);
    await parserDone;
    await Promise.all(filePromises);
    if (firstError) throw firstError;
  } catch (err) {
    await cleanupTempFiles(tempPaths);
    throw err;
  }

  // Rename temp files into final place
  try {
    for (const s of staged) {
      const tempName = `.${path.basename(s.storagePath)}.tmp`;
      const src = path.join(destDir, tempName);
      const dst = path.join(destDir, path.basename(s.storagePath));
      fs.renameSync(src, dst);
    }
  } catch (err) {
    await cleanupTempFiles(tempPaths);
    // Also clean any already-renamed finals
    for (const s of staged) {
      try { fs.unlinkSync(path.join(uploadsDir(), s.storagePath)); } catch { /* ignore */ }
    }
    throw err;
  }

  return { files: staged, fields };
}

async function cleanupTempFiles(paths: string[]) {
  for (const p of paths) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }
}

export class UploadError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
