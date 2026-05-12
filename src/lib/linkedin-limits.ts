// Helpers for the LinkedIn rate-limit settings + usage queries.
// Storage: a plain JSON file at ~/.harbour/state/linkedin-limits.json (not encrypted).
// Usage: computed from the user-created `contacts` / `interactions` Harbour databases.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { getDb } from "./db/schema";

export type LinkedInLimits = {
  maxDmsPerDay: number;
  maxCommentsNonContactPerDay: number;
  maxCommentsContactPerDay: number;
  spreadHours: number;
  minSecondsBetweenActions: number;
  dmRewriteVariations: number;
  // Human-like pacing (round 5). All optional with sensible defaults so older
  // JSON files keep working — `readLimits()` merges DEFAULT_LIMITS on top.
  maxWritesPerHour: number;        // rolling 60m ceiling on outbound DM + comment combined
  activeHoursStart: number;        // local-tz hour 0-23 (inclusive)
  activeHoursEnd: number;          // local-tz hour 0-23 (exclusive)
  jitterMinSeconds: number;        // min random delay between writes
  jitterMaxSeconds: number;        // max random delay between writes
  burstSize: number;               // after N consecutive writes, take a longer break
  burstBreakMinSeconds: number;    // lower bound of burst break
  burstBreakMaxSeconds: number;    // upper bound of burst break
  cronJitterMaxSeconds: number;    // cron wrapper pre-sleep upper bound (breaks :00/:30 fingerprint)
  useExtensionForSend: boolean;    // when true, Playwright workflow no-ops + the Chrome extension is responsible for shipping approved drafts via Voyager API
  updatedAt: number;
};

export type LinkedInUsage = {
  dms24h: number;
  commentsNonContact24h: number;
  commentsContact24h: number;
  lastActionAt: number | null;
};

export const DEFAULT_LIMITS: LinkedInLimits = {
  maxDmsPerDay: 0,
  maxCommentsNonContactPerDay: 0,
  maxCommentsContactPerDay: 0,
  spreadHours: 8,
  minSecondsBetweenActions: 30,
  dmRewriteVariations: 5,
  maxWritesPerHour: 15,
  activeHoursStart: 8,
  activeHoursEnd: 22,
  jitterMinSeconds: 45,
  jitterMaxSeconds: 180,
  burstSize: 3,
  burstBreakMinSeconds: 600,
  burstBreakMaxSeconds: 1500,
  cronJitterMaxSeconds: 600,
  useExtensionForSend: false,
  updatedAt: 0,
};

export function limitsPath(): string {
  return join(homedir(), ".harbour", "state", "linkedin-limits.json");
}

export function readLimits(): LinkedInLimits {
  const p = limitsPath();
  if (!existsSync(p)) return { ...DEFAULT_LIMITS };
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8"));
    return { ...DEFAULT_LIMITS, ...raw };
  } catch {
    return { ...DEFAULT_LIMITS };
  }
}

export function writeLimits(patch: Partial<LinkedInLimits>): LinkedInLimits {
  const current = readLimits();
  const next: LinkedInLimits = {
    ...current,
    ...patch,
    updatedAt: Math.floor(Date.now() / 1000),
  };
  const p = limitsPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(next, null, 2));
  return next;
}

// Discover the `contacts` and `interactions` Harbour databases by name.
// Returns table names like `d_contacts`, `d_interactions` — or null if not yet created.
function discoverTableNames(): { contacts: string | null; interactions: string | null } {
  const db = getDb();
  const rows = db
    .prepare(`SELECT name, table_name FROM databases WHERE name IN ('contacts', 'interactions')`)
    .all() as { name: string; table_name: string }[];
  let contacts: string | null = null;
  let interactions: string | null = null;
  for (const r of rows) {
    if (r.name === "contacts") contacts = r.table_name;
    if (r.name === "interactions") interactions = r.table_name;
  }
  return { contacts, interactions };
}

export function computeUsage(): LinkedInUsage {
  const { contacts, interactions } = discoverTableNames();
  const empty: LinkedInUsage = {
    dms24h: 0,
    commentsNonContact24h: 0,
    commentsContact24h: 0,
    lastActionAt: null,
  };
  if (!interactions) return empty;

  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - 86400;

  // DMs in last 24h (outbound only).
  const dmRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM "${interactions}" WHERE direction = 'out' AND type = 'dm' AND created_at > ?`
    )
    .get(cutoff) as { c: number };

  // Comments split by contact-tag membership. If contacts table missing, all count as non-contact.
  let contactCount = 0;
  let nonContactCount = 0;
  if (contacts) {
    const split = db
      .prepare(
        `SELECT
           SUM(CASE WHEN c.tags LIKE '%"connection"%' THEN 1 ELSE 0 END) AS contact_count,
           SUM(CASE WHEN c.tags IS NULL OR c.tags NOT LIKE '%"connection"%' THEN 1 ELSE 0 END) AS non_contact_count
         FROM "${interactions}" i
         LEFT JOIN "${contacts}" c ON c._id = i.contact_db_id
         WHERE i.direction = 'out' AND i.type = 'comment' AND i.created_at > ?`
      )
      .get(cutoff) as { contact_count: number | null; non_contact_count: number | null };
    contactCount = split.contact_count ?? 0;
    nonContactCount = split.non_contact_count ?? 0;
  } else {
    const total = db
      .prepare(
        `SELECT COUNT(*) AS c FROM "${interactions}" WHERE direction = 'out' AND type = 'comment' AND created_at > ?`
      )
      .get(cutoff) as { c: number };
    nonContactCount = total.c;
  }

  const last = db
    .prepare(
      `SELECT MAX(created_at) AS t FROM "${interactions}" WHERE direction = 'out'`
    )
    .get() as { t: number | null };

  return {
    dms24h: dmRow.c,
    commentsContact24h: contactCount,
    commentsNonContact24h: nonContactCount,
    lastActionAt: last.t,
  };
}

// Count outbound writes (DMs + comments) in the last `seconds` seconds.
// Used by per-hour rate-limit gates in workflows and the /dms banner.
export function computeUsageWindow(seconds: number): { writes: number; lastWriteAt: number | null } {
  const { interactions } = discoverTableNames();
  if (!interactions) return { writes: 0, lastWriteAt: null };
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - Math.max(1, seconds);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c, MAX(COALESCE(sent_at, created_at)) AS t
       FROM "${interactions}"
       WHERE direction = 'out' AND type IN ('dm','comment')
         AND COALESCE(sent_at, created_at) > ?`
    )
    .get(cutoff) as { c: number; t: number | null };
  return { writes: row.c ?? 0, lastWriteAt: row.t ?? null };
}

export type ConnectionsSyncInfo = {
  lastSyncedAt: number | null;
};

const SYNC_INFO_PATH = () =>
  join(homedir(), ".harbour", "state", "linkedin-connections-sync.json");

export function readConnectionsSyncInfo(): ConnectionsSyncInfo {
  const p = SYNC_INFO_PATH();
  if (!existsSync(p)) return { lastSyncedAt: null };
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return { lastSyncedAt: null };
  }
}
