// Zips the chrome-extension/ directory on-the-fly and returns it as a
// downloadable .zip. The extension is plain MV3 static files (~36 KB) so
// rebuilding the archive per-request is fine and means edits to
// chrome-extension/ are picked up without a server restart.

import { NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import AdmZip from "adm-zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extensionDir(): string {
  return join(process.cwd(), "chrome-extension");
}

function readManifestVersion(dir: string): string | null {
  try {
    const raw = readFileSync(join(dir, "manifest.json"), "utf-8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

export const GET = withUserAuth(async () => {
  const dir = extensionDir();

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return NextResponse.json(
      { error: `chrome-extension dir not found at ${dir}: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  const zip = new AdmZip();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name === "README.md") continue;
    if (entry.name.startsWith(".")) continue;
    zip.addLocalFile(join(dir, entry.name));
  }

  const buffer = zip.toBuffer();
  const version = readManifestVersion(dir);
  const filename = version
    ? `harbour-linkedin-bridge-${version}.zip`
    : "harbour-linkedin-bridge.zip";

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": buffer.length.toString(),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
});
