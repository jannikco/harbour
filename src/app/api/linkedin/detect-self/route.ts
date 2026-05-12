import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { spawnNodeScript } from "@/lib/linkedin-process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function scriptPath() {
  return join(homedir(), ".harbour", "workflows", "linkedin-detect-self.mjs");
}

async function upsertProfileEnvVar(value: string) {
  const schema = await import("@/lib/db/schema");
  const enc = await import("@/lib/encryption");
  const { v4: uuid } = await import("uuid");
  const db = schema.getDb();
  const existing = db
    .prepare(`SELECT id FROM env_vars WHERE name = ?`)
    .get("LINKEDIN_PROFILE_URL") as { id: string } | undefined;
  const encrypted = enc.encrypt(value);
  const now = Math.floor(Date.now() / 1000);
  if (existing) {
    db.prepare(`UPDATE env_vars SET encrypted_value = ?, updated_at = ? WHERE id = ?`)
      .run(encrypted, now, existing.id);
    return existing.id;
  }
  const id = uuid();
  db.prepare(
    `INSERT INTO env_vars (id, name, encrypted_value, pinned, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`
  ).run(id, "LINKEDIN_PROFILE_URL", encrypted, now, now);
  return id;
}

export const POST = withAuth(async () => {
  const script = scriptPath();
  if (!existsSync(script)) {
    return NextResponse.json({ error: `script missing: ${script}` }, { status: 500 });
  }

  return new Promise<Response>((resolve) => {
    const child = spawnNodeScript(script, []);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
    }, 60_000);
    child.on("exit", async (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve(
          NextResponse.json(
            { ok: false, exitCode: code, error: stderr.trim() || `exit ${code}` },
            { status: 502 }
          )
        );
        return;
      }
      const url = stdout.trim().split("\n").pop() || "";
      if (!url.includes("/in/")) {
        resolve(NextResponse.json({ ok: false, error: "no URL detected", raw: stdout }, { status: 502 }));
        return;
      }
      try {
        await upsertProfileEnvVar(url);
      } catch (err) {
        resolve(NextResponse.json({ ok: false, error: String(err) }, { status: 500 }));
        return;
      }
      resolve(NextResponse.json({ ok: true, profileUrl: url }));
    });
  });
});
