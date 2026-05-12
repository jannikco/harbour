// Importer + query helpers for the LinkedIn DM inbox.
// Stores in the same `interactions` Harbour database (type=dm),
// joined to `contacts` by counterparty name (LinkedIn DM headers
// use opaque profile URNs, not clean /in/<handle> URLs — so name
// is the primary matcher).

import { existsSync, readFileSync } from "fs";
import { getDb } from "./db/schema";
import { serializeTags, parseTags } from "./contacts-types";

function tables(): { contacts: string | null; interactions: string | null } {
  const db = getDb();
  const rows = db
    .prepare(`SELECT name, table_name FROM databases WHERE name IN ('contacts','interactions')`)
    .all() as { name: string; table_name: string }[];
  let contacts: string | null = null;
  let interactions: string | null = null;
  for (const r of rows) {
    if (r.name === "contacts") contacts = r.table_name;
    if (r.name === "interactions") interactions = r.table_name;
  }
  return { contacts, interactions };
}

function readJsonl(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(Boolean) as Record<string, unknown>[];
}

// LinkedIn message timestamp resolution:
// 1. Prefer ISO datetime attribute from <time datetime="...">
// 2. Fallback: parse the visible text ("5h", "Yesterday 9:42 AM", etc.)
// 3. Last resort: now() — but only if BOTH ISO and text are missing
function resolveTimestamp(
  iso: string | null | undefined,
  textTime: string | null | undefined
): number {
  if (iso) {
    const t = Date.parse(iso);
    if (Number.isFinite(t)) return Math.floor(t / 1000);
  }
  return parseTime(textTime);
}

function parseTime(s: string | null | undefined): number {
  if (!s) return Math.floor(Date.now() / 1000);
  const now = new Date();
  const lower = s.toLowerCase().trim();

  // "5 min ago" / "5m"
  const rel = lower.match(/^(\d+)\s*(min|hour|day|week|month|year|m|h|d|w|mo|y)s?\s*(ago)?$/);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const u = rel[2];
    const secs = (u === "min" || u === "m") ? n * 60
              : (u === "hour" || u === "h") ? n * 3600
              : (u === "day" || u === "d") ? n * 86400
              : (u === "week" || u === "w") ? n * 7 * 86400
              : (u === "month" || u === "mo") ? n * 30 * 86400
              : (u === "year" || u === "y") ? n * 365 * 86400 : 0;
    return Math.floor(now.getTime() / 1000) - secs;
  }

  // "Yesterday 9:42 AM" / "Yesterday"
  const yesterday = lower.match(/^yesterday(?:\s+(\d{1,2}):(\d{2})\s*(am|pm)?)?$/);
  if (yesterday) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    if (yesterday[1]) {
      let h = parseInt(yesterday[1], 10);
      const m = parseInt(yesterday[2], 10);
      const ampm = yesterday[3];
      if (ampm === "pm" && h < 12) h += 12;
      if (ampm === "am" && h === 12) h = 0;
      d.setHours(h, m, 0, 0);
    } else {
      d.setHours(12, 0, 0, 0); // noon yesterday as fallback
    }
    return Math.floor(d.getTime() / 1000);
  }

  // "Today 9:42 AM" / "Today" — use today at given time, or noon today
  const today = lower.match(/^today(?:\s+(\d{1,2}):(\d{2})\s*(am|pm)?)?$/);
  if (today) {
    const d = new Date(now);
    if (today[1]) {
      let h = parseInt(today[1], 10);
      const m = parseInt(today[2], 10);
      const ampm = today[3];
      if (ampm === "pm" && h < 12) h += 12;
      if (ampm === "am" && h === 12) h = 0;
      d.setHours(h, m, 0, 0);
    } else {
      d.setHours(8, 0, 0, 0); // 08:00 today — earliest plausible "today" reference
    }
    return Math.floor(d.getTime() / 1000);
  }

  // Bare "9:42" / "9:42 AM" → today at that time
  const hm = lower.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
  if (hm) {
    const d = new Date(now);
    let h = parseInt(hm[1], 10);
    const m = parseInt(hm[2], 10);
    const ampm = hm[3];
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    d.setHours(h, m, 0, 0);
    // If the resulting time is in the future (e.g. message says "11:00 PM" but
    // we're scraping at 09:00 AM the next day), subtract a day.
    if (d.getTime() > now.getTime()) d.setDate(d.getDate() - 1);
    return Math.floor(d.getTime() / 1000);
  }

  // Day-of-week ("Monday", "Tuesday") — within last 7 days
  const dow = ["sun","mon","tue","wed","thu","fri","sat"];
  for (let i = 0; i < dow.length; i++) {
    if (lower.startsWith(dow[i])) {
      const d = new Date(now);
      const diff = (d.getDay() - i + 7) % 7 || 7;
      d.setDate(d.getDate() - diff);
      d.setHours(12, 0, 0, 0);
      return Math.floor(d.getTime() / 1000);
    }
  }

  // Long-format date like "May 4" → this year
  const monthMatch = lower.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})/i);
  if (monthMatch) {
    const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const monthIdx = months.indexOf(monthMatch[1].slice(0, 3).toLowerCase());
    if (monthIdx >= 0) {
      const d = new Date(now);
      d.setMonth(monthIdx, parseInt(monthMatch[2], 10));
      d.setHours(12, 0, 0, 0);
      if (d.getTime() > now.getTime()) d.setFullYear(d.getFullYear() - 1);
      return Math.floor(d.getTime() / 1000);
    }
  }

  // Final fallback — yesterday noon, so it doesn't pollute "just now" filters
  const fallback = new Date(now);
  fallback.setDate(fallback.getDate() - 1);
  fallback.setHours(12, 0, 0, 0);
  return Math.floor(fallback.getTime() / 1000);
}

export function importDmsJsonl(path: string): {
  messagesInserted: number;
  contactsUpserted: number;
  contactsMatched: number;
} {
  const t = tables();
  if (!t.contacts || !t.interactions) {
    return { messagesInserted: 0, contactsUpserted: 0, contactsMatched: 0 };
  }
  const rows = readJsonl(path);
  const db = getDb();
  const nowSec = Math.floor(Date.now() / 1000);

  let messagesInserted = 0;
  let contactsUpserted = 0;
  let contactsMatched = 0;

  const tx = db.transaction((rows: Record<string, unknown>[]) => {
    // contactCache keyed by counterparty_name (case-insensitive)
    const cache = new Map<string, number>();
    for (const row of rows) {
      const name = (row.counterparty_name as string) || "";
      if (!name) continue;
      const key = name.toLowerCase();
      let contactId = cache.get(key);
      if (contactId == null) {
        // Try existing contact by name (case-insensitive)
        const existing = db
          .prepare(`SELECT _id, tags FROM "${t.contacts}" WHERE LOWER(name) = ? LIMIT 1`)
          .get(key) as { _id: number; tags: string | null } | undefined;
        if (existing) {
          contactId = existing._id;
          contactsMatched++;
          // No URL overwrite — leave the cleaner /in/<handle> URL from comments if it exists
        } else {
          // Create new with opaque URL as a fallback
          const url = (row.counterparty_url as string) || null;
          const tags: string[] = [];
          const r = db.prepare(
            `INSERT INTO "${t.contacts}"
               (linkedin_url, name, status, first_seen, last_interaction_at, tags)
             VALUES (?, ?, 'new', ?, ?, ?)`
          ).run(url, name, nowSec, nowSec, serializeTags(tags));
          contactId = Number(r.lastInsertRowid);
          contactsUpserted++;
        }
        cache.set(key, contactId);
      }

      const msgUrn = (row.message_urn as string) || null;
      const text = ((row.text as string) || "").slice(0, 2000);
      const ts = resolveTimestamp(
        (row.iso_time as string) || null,
        (row.time_text as string) || ""
      );
      const direction = (row.direction === "out" ? "out" : "in") as "in" | "out";
      const runIdKey = msgUrn ? `linkedin-dm-${msgUrn}` : null;

      // Run BOTH dedup checks. LinkedIn's DOM sometimes emits the same
      // message twice (once with data-event-urn, once without) — if we
      // only check one path we miss the cross-form duplicate. Either
      // signal of a match is enough to skip.
      // Fuzzy match: same content-prefix + direction + contact, within 15 minutes.
      // The window was 120s but LinkedIn's relative time text quantizes / drifts
      // across consecutive scrapes (e.g. "5:23 PM" → "5:35 PM" for the same emoji
      // sent at 5:35). 15min absorbs that drift without false-positives for
      // genuinely separate messages from the same contact.
      const fuzzyDup = db.prepare(
        `SELECT _id, created_at FROM "${t.interactions}"
         WHERE type = 'dm' AND contact_db_id = ? AND direction = ?
           AND substr(COALESCE(content_excerpt,''), 1, 300) = ?
           AND ABS(created_at - ?) < 900`
      ).get(contactId, direction, text.slice(0, 300), ts) as { _id: number; created_at: number } | undefined;

      const urnDup = runIdKey
        ? db.prepare(
            `SELECT _id FROM "${t.interactions}"
             WHERE type = 'dm' AND run_id = ?`
          ).get(runIdKey) as { _id: number } | undefined
        : undefined;

      // Short-content cross-scrape dedup: for emoji/short messages (≤20 chars),
      // exact content match + same contact + same direction over a 24h window is
      // overwhelmingly the same logical message captured across re-renders.
      // LinkedIn's DOM event-urns rotate for reactions/emojis so URN check misses.
      let shortContentDup: { _id: number; created_at: number } | undefined;
      if (text.length > 0 && text.length <= 20) {
        shortContentDup = db.prepare(
          `SELECT _id, created_at FROM "${t.interactions}"
           WHERE type = 'dm' AND contact_db_id = ? AND direction = ?
             AND COALESCE(content_excerpt,'') = ?
             AND ABS(created_at - ?) < 86400`
        ).get(contactId, direction, text, ts) as { _id: number; created_at: number } | undefined;
      }

      // On any dedup hit, refresh the existing row's timestamp + run_id from the
      // newer scrape (later read = more accurate LinkedIn truth). Then skip insert.
      const dedupHit = fuzzyDup || shortContentDup;
      if (dedupHit) {
        if (ts > dedupHit.created_at) {
          db.prepare(
            `UPDATE "${t.interactions}"
             SET created_at = ?,
                 run_id = COALESCE(run_id, ?),
                 sent_at = CASE WHEN ? = 'out' THEN ? ELSE sent_at END
             WHERE _id = ?`
          ).run(ts, runIdKey, direction, ts, dedupHit._id);
          db.prepare(
            `UPDATE "${t.contacts}" SET last_interaction_at = MAX(COALESCE(last_interaction_at,0), ?) WHERE _id = ?`
          ).run(ts, contactId);
        }
        continue;
      }
      if (urnDup) continue;

      // Backfill-on-URN: if this incoming row has a URN, look for a
      // matching content-prefix placeholder row inserted earlier with
      // NULL run_id (typical when an earlier scrape rendered the
      // message with time_text="Today" — the timestamp parser defaults
      // it to 08:00 today and emits no urn). Upgrade that placeholder
      // in place with the canonical run_id + the more accurate
      // timestamp, instead of inserting a second row.
      if (runIdKey) {
        const placeholderRow = db.prepare(
          `SELECT _id FROM "${t.interactions}"
           WHERE type = 'dm' AND contact_db_id = ? AND direction = ?
             AND substr(COALESCE(content_excerpt,''), 1, 300) = ?
             AND run_id IS NULL
           ORDER BY _id ASC
           LIMIT 1`
        ).get(contactId, direction, text.slice(0, 300)) as { _id: number } | undefined;
        if (placeholderRow) {
          db.prepare(
            `UPDATE "${t.interactions}"
             SET run_id = ?, created_at = ?, content_excerpt = ?,
                 sent_at = CASE WHEN ? = 'out' THEN ? ELSE sent_at END
             WHERE _id = ?`
          ).run(runIdKey, ts, text, direction, ts, placeholderRow._id);
          db.prepare(
            `UPDATE "${t.contacts}" SET last_interaction_at = MAX(COALESCE(last_interaction_at,0), ?) WHERE _id = ?`
          ).run(ts, contactId);
          continue;
        }
      }

      // Note: post_url is reused here to stash the LinkedIn messaging
      // thread deep-link (https://www.linkedin.com/messaging/thread/...)
      // so the UI can offer a one-click "Reply in LinkedIn" button.
      const threadUrl = (row.thread_url as string) || null;
      db.prepare(
        `INSERT INTO "${t.interactions}"
           (contact_db_id, type, direction, channel, content_excerpt, post_url,
            run_id, created_at, sent_at, draft_status)
         VALUES (?, 'dm', ?, 'linkedin', ?, ?, ?, ?, ?, ?)`
      ).run(
        contactId,
        direction,
        text,
        threadUrl,
        runIdKey,
        ts,
        direction === "out" ? ts : null,
        direction === "out" ? "sent" : null
      );
      messagesInserted++;

      db.prepare(
        `UPDATE "${t.contacts}" SET last_interaction_at = MAX(COALESCE(last_interaction_at,0), ?) WHERE _id = ?`
      ).run(ts, contactId);
    }
  });
  tx(rows);
  return { messagesInserted, contactsUpserted, contactsMatched };
}

// ─── Query helpers for the /dms page ────────────────────────────────────────

export type DmThread = {
  contact_id: number;
  contact_name: string | null;
  contact_headline: string | null;
  contact_company: string | null;
  contact_linkedin_url: string | null;
  contact_status: string;
  contact_tags: string[];
  message_count: number;
  in_count: number;
  out_count: number;
  last_message_at: number;
  last_message_preview: string;
  last_direction: "in" | "out";
  unreplied: boolean; // last message is inbound AND no outbound after it
};

export type DmThreadWithAgg = DmThread & {
  pending_drafts: number;
  approved_drafts: number;
  needs_human: number;
};

export function listDmThreadsWithAgg(opts: { unreplied?: boolean; limit?: number } = {}): DmThreadWithAgg[] {
  const threads = listDmThreads(opts);
  const agg = getDraftStateByContact();
  return threads.map((t) => {
    const a = agg.get(t.contact_id) ?? emptyAgg();
    return {
      ...t,
      pending_drafts: a.pending,
      approved_drafts: a.approved,
      needs_human: a.needsHuman,
    };
  });
}

export function listDmThreads(opts: { unreplied?: boolean; limit?: number } = {}): DmThread[] {
  const t = tables();
  if (!t.contacts || !t.interactions) return [];
  const db = getDb();
  const limit = Math.max(1, Math.min(500, opts.limit ?? 100));

  const rows = db
    .prepare(
      `
      SELECT
        c._id AS contact_id,
        c.name AS contact_name,
        c.headline AS contact_headline,
        c.company AS contact_company,
        c.linkedin_url AS contact_linkedin_url,
        c.status AS contact_status,
        c.tags AS contact_tags,
        COUNT(i._id) AS message_count,
        SUM(CASE WHEN i.direction = 'in' THEN 1 ELSE 0 END) AS in_count,
        SUM(CASE WHEN i.direction = 'out' THEN 1 ELSE 0 END) AS out_count,
        MAX(i.created_at) AS last_message_at,
        (SELECT direction FROM "${t.interactions}" sub
           WHERE sub.contact_db_id = c._id AND sub.type = 'dm'
           ORDER BY sub.created_at DESC LIMIT 1) AS last_direction,
        (SELECT content_excerpt FROM "${t.interactions}" sub
           WHERE sub.contact_db_id = c._id AND sub.type = 'dm'
           ORDER BY sub.created_at DESC LIMIT 1) AS last_preview
      FROM "${t.interactions}" i
      JOIN "${t.contacts}" c ON c._id = i.contact_db_id
      WHERE i.type = 'dm'
      GROUP BY c._id
      ORDER BY last_message_at DESC
      LIMIT ?
      `
    )
    .all(limit) as Record<string, unknown>[];

  const threads: DmThread[] = rows.map((r) => ({
    contact_id: r.contact_id as number,
    contact_name: (r.contact_name as string) ?? null,
    contact_headline: (r.contact_headline as string) ?? null,
    contact_company: (r.contact_company as string) ?? null,
    contact_linkedin_url: (r.contact_linkedin_url as string) ?? null,
    contact_status: (r.contact_status as string) ?? "new",
    contact_tags: parseTags((r.contact_tags as string) ?? null),
    message_count: r.message_count as number,
    in_count: (r.in_count as number) ?? 0,
    out_count: (r.out_count as number) ?? 0,
    last_message_at: r.last_message_at as number,
    last_message_preview: ((r.last_preview as string) ?? "").slice(0, 200),
    last_direction: (r.last_direction as "in" | "out") ?? "in",
    unreplied: (r.last_direction as string) === "in",
  }));

  if (opts.unreplied) return threads.filter((t) => t.unreplied);
  return threads;
}

export type DmDraft = {
  id: number;
  contact_db_id: number;
  text: string;
  draft_status: string; // pending | approved | rejected | no-reply | needs-human | sent
  language: string | null;
  draft_path: string | null;
  classification: string | null; // parsed from draft_path filename / frontmatter where possible
  created_at: number;
};

export function listDraftsForContact(contactId: number): DmDraft[] {
  const t = tables();
  if (!t.interactions) return [];
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT _id, contact_db_id, content_excerpt, draft_status, language, draft_path, created_at
       FROM "${t.interactions}"
       WHERE contact_db_id = ? AND direction = 'out' AND type = 'reply'
         AND draft_status IN ('pending','approved','needs-human','rejected','no-reply','sent')
       ORDER BY created_at DESC`
    )
    .all(contactId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r._id as number,
    contact_db_id: r.contact_db_id as number,
    text: ((r.content_excerpt as string) ?? "").trim(),
    draft_status: (r.draft_status as string) ?? "pending",
    language: (r.language as string) ?? null,
    draft_path: (r.draft_path as string) ?? null,
    classification: parseClassificationFromPath((r.draft_path as string) ?? null),
    created_at: r.created_at as number,
  }));
}

export function getDraftById(id: number): DmDraft | null {
  const t = tables();
  if (!t.interactions) return null;
  const db = getDb();
  const r = db
    .prepare(
      `SELECT _id, contact_db_id, content_excerpt, draft_status, language, draft_path, created_at
       FROM "${t.interactions}" WHERE _id = ? AND direction = 'out' AND type = 'reply'`
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: r._id as number,
    contact_db_id: r.contact_db_id as number,
    text: ((r.content_excerpt as string) ?? "").trim(),
    draft_status: (r.draft_status as string) ?? "pending",
    language: (r.language as string) ?? null,
    draft_path: (r.draft_path as string) ?? null,
    classification: parseClassificationFromPath((r.draft_path as string) ?? null),
    created_at: r.created_at as number,
  };
}

function parseClassificationFromPath(p: string | null): string | null {
  if (!p) return null;
  // Drafts are stored at .../<contact>-<msg_id>.md — classification is in frontmatter.
  // For UI badge, peek at the file's frontmatter if present.
  try {
    const fs = eval("require")("fs") as typeof import("fs");
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, "utf-8");
    const fm = raw.match(/classification:\s*([a-z-]+)/i);
    return fm?.[1] ?? null;
  } catch {
    return null;
  }
}

export function updateDraftText(id: number, newText: string): DmDraft | null {
  const t = tables();
  if (!t.interactions) return null;
  const db = getDb();
  const draft = getDraftById(id);
  if (!draft) return null;

  db.prepare(
    `UPDATE "${t.interactions}" SET content_excerpt = ? WHERE _id = ?`
  ).run(newText.slice(0, 2000), id);

  // Update the markdown file if it exists (body only — preserve frontmatter)
  if (draft.draft_path) {
    try {
      const fs = eval("require")("fs") as typeof import("fs");
      if (fs.existsSync(draft.draft_path)) {
        const raw = fs.readFileSync(draft.draft_path, "utf-8");
        const m = raw.match(/^(---[\s\S]+?---\s*)([\s\S]*)$/);
        const newContent = m ? `${m[1]}\n${newText}\n` : newText + "\n";
        fs.writeFileSync(draft.draft_path, newContent);
      }
    } catch {
      // best-effort
    }
  }
  return getDraftById(id);
}

export function setDraftStatus(id: number, status: "approved" | "rejected"): DmDraft | null {
  const t = tables();
  if (!t.interactions) return null;
  const db = getDb();
  const draft = getDraftById(id);
  if (!draft) return null;

  db.prepare(
    `UPDATE "${t.interactions}" SET draft_status = ? WHERE _id = ?`
  ).run(status, id);

  // Move the file between pending/approved/rejected dirs
  if (draft.draft_path) {
    try {
      const fs = eval("require")("fs") as typeof import("fs");
      const path = eval("require")("path") as typeof import("path");
      if (fs.existsSync(draft.draft_path)) {
        const parts = draft.draft_path.split("/");
        // Find the segment "pending" / "approved" / "rejected" and swap it
        const idx = parts.findIndex((p) => p === "pending" || p === "approved" || p === "rejected");
        if (idx >= 0) {
          parts[idx] = status;
          const newPath = parts.join("/");
          fs.mkdirSync(path.dirname(newPath), { recursive: true });
          fs.renameSync(draft.draft_path, newPath);
          db.prepare(`UPDATE "${t.interactions}" SET draft_path = ? WHERE _id = ?`).run(newPath, id);
        }
      }
    } catch {
      // best-effort
    }
  }
  return getDraftById(id);
}

export function getDmThread(contactId: number): {
  contact: {
    id: number; name: string | null; headline: string | null;
    company: string | null; linkedin_url: string | null;
    linkedin_thread_url: string | null;
    status: string; tags: string[];
  };
  messages: Array<{
    id: number;
    direction: "in" | "out";
    text: string;
    created_at: number;
    sent_at: number | null;
  }>;
  drafts: DmDraft[];
  originating_comment: {
    excerpt: string;
    post_url: string;
    created_at: number;
  } | null;
} | null {
  const t = tables();
  if (!t.contacts || !t.interactions) return null;
  const db = getDb();

  const c = db
    .prepare(
      `SELECT _id, name, headline, company, linkedin_url, status, tags
       FROM "${t.contacts}" WHERE _id = ?`
    )
    .get(contactId) as Record<string, unknown> | undefined;
  if (!c) return null;

  const msgs = db
    .prepare(
      `SELECT _id, direction, content_excerpt, post_url, created_at, sent_at
       FROM "${t.interactions}"
       WHERE contact_db_id = ? AND type = 'dm'
       ORDER BY created_at ASC`
    )
    .all(contactId) as Record<string, unknown>[];

  // The most recent DM row's post_url is the LinkedIn messaging-thread deep
  // link (reused field — see importDmsJsonl). Walk back to find one.
  const threadUrlMsg = [...msgs].reverse().find(
    (m) => typeof m.post_url === "string" && (m.post_url as string).includes("/messaging/thread/")
  );
  const linkedinThreadUrl = (threadUrlMsg?.post_url as string) ?? null;

  // Originating comment — the inbound LinkedIn comment that first surfaced this
  // contact. Used in the draft card so the user can verify the right
  // lead-magnet was picked. NULL if the contact never commented (came in via
  // connection request, sales-nav reach-out, etc.).
  const originatingCommentRow = db
    .prepare(
      `SELECT content_excerpt, post_url, created_at
       FROM "${t.interactions}"
       WHERE contact_db_id = ? AND type = 'comment' AND direction = 'in'
         AND channel = 'linkedin' AND post_url IS NOT NULL
       ORDER BY created_at ASC
       LIMIT 1`
    )
    .get(contactId) as
    | { content_excerpt: string | null; post_url: string; created_at: number }
    | undefined;
  const originatingComment = originatingCommentRow
    ? {
        excerpt: originatingCommentRow.content_excerpt ?? "",
        post_url: originatingCommentRow.post_url,
        created_at: originatingCommentRow.created_at,
      }
    : null;

  return {
    contact: {
      id: c._id as number,
      name: (c.name as string) ?? null,
      headline: (c.headline as string) ?? null,
      company: (c.company as string) ?? null,
      linkedin_url: (c.linkedin_url as string) ?? null,
      linkedin_thread_url: linkedinThreadUrl,
      status: (c.status as string) ?? "new",
      tags: parseTags((c.tags as string) ?? null),
    },
    messages: msgs.map((r) => ({
      id: r._id as number,
      direction: (r.direction as "in" | "out") ?? "in",
      text: (r.content_excerpt as string) ?? "",
      created_at: r.created_at as number,
      sent_at: (r.sent_at as number) ?? null,
    })),
    drafts: listDraftsForContact(contactId),
    originating_comment: originatingComment,
  };
}

// Aggregate draft state per contact, for the thread-list badges.
export function getDraftStateByContact(): Map<number, {
  pending: number;
  approved: number;
  rejected: number;
  needsHuman: number;
  noReply: number;
  sent: number;
}> {
  const t = tables();
  const out = new Map<number, ReturnType<typeof emptyAgg>>();
  if (!t.interactions) return out;
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT contact_db_id, draft_status, COUNT(*) AS c
       FROM "${t.interactions}"
       WHERE direction='out' AND type='reply'
         AND draft_status IN ('pending','approved','rejected','no-reply','needs-human','sent')
       GROUP BY contact_db_id, draft_status`
    )
    .all() as { contact_db_id: number; draft_status: string; c: number }[];
  for (const r of rows) {
    const agg = out.get(r.contact_db_id) ?? emptyAgg();
    if (r.draft_status === "pending") agg.pending += r.c;
    else if (r.draft_status === "approved") agg.approved += r.c;
    else if (r.draft_status === "rejected") agg.rejected += r.c;
    else if (r.draft_status === "needs-human") agg.needsHuman += r.c;
    else if (r.draft_status === "no-reply") agg.noReply += r.c;
    else if (r.draft_status === "sent") agg.sent += r.c;
    out.set(r.contact_db_id, agg);
  }
  return out;
}
function emptyAgg() {
  return { pending: 0, approved: 0, rejected: 0, needsHuman: 0, noReply: 0, sent: 0 };
}
