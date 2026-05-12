import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { spawnNodeScript } from "@/lib/linkedin-process";
import { importDiscoveryJsonl } from "@/lib/posts-db";
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function scriptPath() {
  return join(homedir(), ".harbour", "workflows", "linkedin-scrape-own-posts.mjs");
}
function outPath() {
  const dir = join(homedir(), ".harbour", "state", "scrapes");
  mkdirSync(dir, { recursive: true });
  return join(dir, `posts-discovery-${Date.now()}.jsonl`);
}

async function readEnvVarValue(name: string): Promise<string | null> {
  // Read directly from Harbour's env_vars table via getDb to avoid a self-fetch.
  const mod = await import("@/lib/db/schema");
  const db = mod.getDb();
  const row = db
    .prepare(`SELECT encrypted_value FROM env_vars WHERE name = ?`)
    .get(name) as { encrypted_value: string } | undefined;
  if (!row) return null;
  const enc = await import("@/lib/encryption");
  try {
    return enc.decrypt(row.encrypted_value);
  } catch {
    return null;
  }
}

export const POST = withAuth(async (req) => {
  let profileUrl: string | null = null;
  try {
    const body = await req.json();
    profileUrl = body?.profileUrl || null;
  } catch {}

  if (!profileUrl) {
    profileUrl = (await readEnvVarValue("LINKEDIN_PROFILE_URL")) || null;
  }
  if (!profileUrl || profileUrl.includes("REPLACE-ME") || !profileUrl.includes("/in/")) {
    return NextResponse.json(
      { error: "LINKEDIN_PROFILE_URL not set. Update it in /env-vars or POST { profileUrl }." },
      { status: 400 }
    );
  }

  const script = scriptPath();
  if (!existsSync(script)) {
    return NextResponse.json({ error: `script missing: ${script}` }, { status: 500 });
  }
  const out = outPath();

  return new Promise<Response>((resolve) => {
    const days = "14";
    const child = spawnNodeScript(script, [profileUrl as string, days, out]);
    let stderr = "";
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
    }, 120_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve(
          NextResponse.json(
            { ok: false, exitCode: code, error: stderr.slice(-600) || `exit ${code}` },
            { status: 502 }
          )
        );
        return;
      }
      const result = importDiscoveryJsonl(out);
      resolve(NextResponse.json({ ok: true, ...result, jsonl: out }));
    });
  });
});
