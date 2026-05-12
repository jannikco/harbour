// Receives LinkedIn cookies + userAgent from the Chrome extension running in
// the user's daily browser. Writes the Playwright-compatible storageState
// atomically so all linkedin-* workflows pick up fresh auth on next invoke.

import { NextResponse } from "next/server";
import { withExtensionAuth } from "@/lib/auth";
import { markExtensionSynced } from "@/lib/db/queries";
import { writeFileSync, renameSync, mkdirSync, chmodSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PwCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

const HARBOUR_HOME = process.env.HARBOUR_HOME || join(homedir(), ".harbour");
const STORAGE_PATH = process.env.LINKEDIN_STORAGE_PATH || join(HARBOUR_HOME, "state", "linkedin-storage.json");
const BROWSER_META_PATH = join(HARBOUR_HOME, "state", "linkedin-browser.json");

function normalizeSameSite(v: unknown): "Strict" | "Lax" | "None" {
  if (v === "Strict" || v === "Lax" || v === "None") return v;
  if (typeof v === "string") {
    const lower = v.toLowerCase();
    if (lower === "strict") return "Strict";
    if (lower === "lax") return "Lax";
    if (lower === "none" || lower === "no_restriction" || lower === "unspecified") return "None";
  }
  return "Lax";
}

function atomicWrite(targetPath: string, contents: string) {
  mkdirSync(dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  writeFileSync(tmp, contents, { mode: 0o600 });
  renameSync(tmp, targetPath);
  try { chmodSync(targetPath, 0o600); } catch { /* ignore on filesystems that don't support it */ }
}

export const POST = withExtensionAuth(async (req, auth) => {
  const body = await req.json().catch(() => null) as {
    cookies?: PwCookie[];
    origins?: Array<{ origin: string; localStorage?: Array<{ name: string; value: string }> }>;
    userAgent?: string;
  } | null;

  if (!body || !Array.isArray(body.cookies)) {
    return NextResponse.json({ error: "cookies array required" }, { status: 400 });
  }

  // Sanitize cookies to Playwright's storageState shape.
  const cookies: PwCookie[] = body.cookies
    .filter((c) => c && typeof c.name === "string" && typeof c.value === "string" && typeof c.domain === "string")
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain.startsWith(".") ? c.domain : `.${c.domain.replace(/^\./, "")}`,
      path: typeof c.path === "string" && c.path.length > 0 ? c.path : "/",
      expires: typeof c.expires === "number" && c.expires > 0 ? c.expires : -1,
      httpOnly: !!c.httpOnly,
      secure: c.secure !== false,
      sameSite: normalizeSameSite(c.sameSite),
    }));

  // Refuse syncs that don't include the primary LinkedIn auth cookie.
  if (!cookies.some((c) => c.name === "li_at")) {
    return NextResponse.json({ error: "no li_at cookie — make sure you're logged into LinkedIn in this Chrome profile" }, { status: 400 });
  }

  const origins = Array.isArray(body.origins) ? body.origins : [];
  const storageState = { cookies, origins };

  atomicWrite(STORAGE_PATH, JSON.stringify(storageState));

  // Persist userAgent separately so Playwright fallback can match the real-Chrome UA.
  const meta = {
    userAgent: typeof body.userAgent === "string" ? body.userAgent : null,
    cookieCount: cookies.length,
    syncedAt: Math.floor(Date.now() / 1000),
    syncedByExtensionId: auth.type === "extension" ? auth.extensionKeyId : null,
  };
  atomicWrite(BROWSER_META_PATH, JSON.stringify(meta, null, 2));

  if (auth.type === "extension") {
    markExtensionSynced(auth.extensionKeyId);
  }

  return NextResponse.json({
    ok: true,
    cookies: cookies.length,
    li_at_present: true,
    syncedAt: meta.syncedAt,
  });
});

// CORS preflight — extensions issue this before the POST.
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
