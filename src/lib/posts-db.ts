// Helpers for the LinkedIn own-posts feature: query the `posts` user-database,
// and import JSONL produced by the three Playwright scrape scripts.

import { existsSync, readFileSync } from "fs";
import { createHash } from "crypto";
import { getDb } from "./db/schema";
import { serializeTags, parseTags } from "./contacts-types";

type Tables = {
  posts: string | null;
  contacts: string | null;
  interactions: string | null;
};

function discoverTables(): Tables {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT name, table_name FROM databases WHERE name IN ('posts','contacts','interactions')`
    )
    .all() as { name: string; table_name: string }[];
  const t: Tables = { posts: null, contacts: null, interactions: null };
  for (const r of rows) {
    if (r.name === "posts") t.posts = r.table_name;
    if (r.name === "contacts") t.contacts = r.table_name;
    if (r.name === "interactions") t.interactions = r.table_name;
  }
  return t;
}

export type PostRow = {
  id: number;
  linkedin_post_id: string;
  post_url: string;
  posted_at: number | null;
  content_excerpt: string | null;
  comment_count: number;
  replied_count: number;
  ignored_count: number;
  reaction_count: number;
  last_scraped_at: number | null;
};

function rowToPost(r: Record<string, unknown>): PostRow {
  return {
    id: r._id as number,
    linkedin_post_id: (r.linkedin_post_id as string) ?? "",
    post_url: (r.post_url as string) ?? "",
    posted_at: (r.posted_at as number) ?? null,
    content_excerpt: (r.content_excerpt as string) ?? null,
    comment_count: (r.comment_count as number) ?? 0,
    replied_count: (r.replied_count as number) ?? 0,
    ignored_count: (r.ignored_count as number) ?? 0,
    reaction_count: (r.reaction_count as number) ?? 0,
    last_scraped_at: (r.last_scraped_at as number) ?? null,
  };
}

export function listPosts(): PostRow[] {
  const t = discoverTables();
  if (!t.posts) return [];
  const rows = getDb()
    .prepare(
      `SELECT _id, linkedin_post_id, post_url, posted_at, content_excerpt,
              comment_count, replied_count, ignored_count, reaction_count,
              last_scraped_at
       FROM "${t.posts}"
       ORDER BY COALESCE(posted_at, _id) DESC`
    )
    .all() as Record<string, unknown>[];
  return rows.map(rowToPost);
}

export type CommenterEngagement = {
  freebie_sent: boolean;
  paid_offer_sent: boolean;
  dm_count: number;
  pending_drafts: number;
  approved_drafts: number;
  is_customer: boolean;
};

export type PostWithComments = {
  post: PostRow;
  comments: Array<{
    interaction_id: number;
    commenter: {
      id: number | null;
      name: string | null;
      headline: string | null;
      company: string | null;
      linkedin_url: string | null;
      tags: string[];
      status: string;
      engagement?: CommenterEngagement;
    };
    comment_text: string;
    comment_time: number | null;
    our_reply: { text: string | null; time: number | null } | null;
  }>;
};

export function getPostWithComments(postId: number): PostWithComments | null {
  const t = discoverTables();
  if (!t.posts) return null;
  const db = getDb();

  const postRow = db
    .prepare(`SELECT * FROM "${t.posts}" WHERE _id = ?`)
    .get(postId) as Record<string, unknown> | undefined;
  if (!postRow) return null;
  const post = rowToPost(postRow);

  if (!t.interactions) return { post, comments: [] };

  // All inbound comments on this post_url
  const inbound = db
    .prepare(
      `SELECT _id, contact_db_id, content_excerpt, created_at
       FROM "${t.interactions}"
       WHERE post_url = ? AND direction = 'in' AND type = 'comment'
       ORDER BY created_at DESC`
    )
    .all(post.post_url) as Record<string, unknown>[];

  // All our replies on this post_url, indexed by contact_db_id (we may have replied to multiple)
  const replyMap = new Map<number, { text: string | null; time: number | null }>();
  if (t.interactions) {
    const out = db
      .prepare(
        `SELECT contact_db_id, content_excerpt, created_at, sent_at
         FROM "${t.interactions}"
         WHERE post_url = ? AND direction = 'out' AND type = 'reply'
         ORDER BY created_at DESC`
      )
      .all(post.post_url) as Record<string, unknown>[];
    for (const r of out) {
      const cid = r.contact_db_id as number;
      if (!replyMap.has(cid)) {
        replyMap.set(cid, {
          text: (r.content_excerpt as string) ?? null,
          time: (r.sent_at as number) ?? (r.created_at as number) ?? null,
        });
      }
    }
  }

  // Fetch contact info for each commenter
  const contactIds = Array.from(new Set(inbound.map((r) => r.contact_db_id as number).filter(Boolean)));
  const contactMap = new Map<number, Record<string, unknown>>();
  if (contactIds.length && t.contacts) {
    const placeholders = contactIds.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT _id, name, headline, company, linkedin_url, tags, status
         FROM "${t.contacts}" WHERE _id IN (${placeholders})`
      )
      .all(...contactIds) as Record<string, unknown>[];
    for (const r of rows) contactMap.set(r._id as number, r);
  }

  // Per-commenter engagement aggregates — gives the post-detail page a one-glance
  // funnel state per row (got freebie? offer sent? customer? draft pending?).
  // Pattern-matches outbound DM URLs against the canonical product surface in
  // upsell-ladder.md (kursus repo).
  const engagementMap = new Map<number, CommenterEngagement>();
  if (contactIds.length && t.interactions) {
    const placeholders = contactIds.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT contact_db_id,
                SUM(CASE WHEN type='dm' AND direction='out' AND (
                  content_excerpt LIKE '%/gratis-claude-cowork%'
                  OR content_excerpt LIKE '%/gratis-17-office-opgaver%'
                  OR content_excerpt LIKE '%/free-claude-cowork-prompts%'
                  OR content_excerpt LIKE '%/free-gdpr-tjekliste%'
                  OR content_excerpt LIKE '%/free-ai-tools%'
                  OR content_excerpt LIKE '%/free-ai-frontlober%'
                  OR content_excerpt LIKE '%/free-expense-guide%'
                ) THEN 1 ELSE 0 END) AS freebie_dms,
                SUM(CASE WHEN type='dm' AND direction='out' AND (
                  content_excerpt LIKE '%/bogpakke-koeb%'
                  OR content_excerpt LIKE '%/claude-cowork-kursus-koeb%'
                  OR content_excerpt LIKE '%/claude-cowork-koeb%'
                  OR content_excerpt LIKE '%/eu-ai-act-kursus%'
                  OR content_excerpt LIKE '%/hjemmeside-koeb%'
                  OR content_excerpt LIKE '%/claude-pakke-koeb%'
                  OR content_excerpt LIKE '%/book-purchase%'
                  OR content_excerpt LIKE '%course-purchase?course_id=%'
                ) THEN 1 ELSE 0 END) AS paid_offer_dms,
                SUM(CASE WHEN type='dm' THEN 1 ELSE 0 END) AS dm_count,
                SUM(CASE WHEN type='reply' AND draft_status='pending' THEN 1 ELSE 0 END) AS pending_drafts,
                SUM(CASE WHEN type='reply' AND draft_status='approved' THEN 1 ELSE 0 END) AS approved_drafts
         FROM "${t.interactions}"
         WHERE contact_db_id IN (${placeholders})
         GROUP BY contact_db_id`
      )
      .all(...contactIds) as Array<{
        contact_db_id: number;
        freebie_dms: number;
        paid_offer_dms: number;
        dm_count: number;
        pending_drafts: number;
        approved_drafts: number;
      }>;
    for (const r of rows) {
      const ct = contactMap.get(r.contact_db_id);
      const tags = parseTags((ct?.tags as string) ?? null);
      engagementMap.set(r.contact_db_id, {
        freebie_sent: (r.freebie_dms ?? 0) > 0,
        paid_offer_sent: (r.paid_offer_dms ?? 0) > 0,
        dm_count: r.dm_count ?? 0,
        pending_drafts: r.pending_drafts ?? 0,
        approved_drafts: r.approved_drafts ?? 0,
        is_customer: tags.includes("customer") || (ct?.status as string) === "customer",
      });
    }
  }

  const comments = inbound.map((r) => {
    const cid = r.contact_db_id as number;
    const ct = contactMap.get(cid);
    return {
      interaction_id: r._id as number,
      commenter: {
        id: cid ?? null,
        name: (ct?.name as string) ?? null,
        headline: (ct?.headline as string) ?? null,
        company: (ct?.company as string) ?? null,
        linkedin_url: (ct?.linkedin_url as string) ?? null,
        tags: parseTags((ct?.tags as string) ?? null),
        status: ((ct?.status as string) ?? "new"),
        engagement: engagementMap.get(cid),
      },
      comment_text: (r.content_excerpt as string) ?? "",
      comment_time: (r.created_at as number) ?? null,
      our_reply: replyMap.get(cid) ?? null,
    };
  });

  return { post, comments };
}

// ─── JSONL imports ──────────────────────────────────────────────────────────

function readJsonl(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf-8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Record<string, unknown>[];
}

function contentHash(s: string): string {
  return createHash("sha1").update(s.slice(0, 200)).digest("hex").slice(0, 16);
}

function parseLinkedInRelative(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.match(/(\d+)\s*(m|h|d|w|mo|y)\b/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const secs =
    unit === "m" ? n * 60 :
    unit === "h" ? n * 3600 :
    unit === "d" ? n * 86400 :
    unit === "w" ? n * 7 * 86400 :
    unit === "mo" ? n * 30 * 86400 :
    unit === "y" ? n * 365 * 86400 : 0;
  return Math.floor(Date.now() / 1000) - secs;
}

export function importDiscoveryJsonl(path: string): { upserted: number; skipped: number } {
  const t = discoverTables();
  if (!t.posts) return { upserted: 0, skipped: 0 };
  const db = getDb();
  const rows = readJsonl(path);

  let upserted = 0;
  let skipped = 0;
  const now = Math.floor(Date.now() / 1000);

  for (const row of rows) {
    const id = (row.linkedin_post_id as string) || "";
    if (!id) { skipped++; continue; }
    const existing = db
      .prepare(`SELECT _id FROM "${t.posts}" WHERE linkedin_post_id = ?`)
      .get(id) as { _id: number } | undefined;
    if (existing) {
      db.prepare(
        `UPDATE "${t.posts}" SET post_url=?, posted_at=COALESCE(?, posted_at),
            content_excerpt=?, comment_count=?, reaction_count=?
         WHERE _id=?`
      ).run(
        (row.post_url as string) ?? null,
        (row.posted_at as number) ?? null,
        (row.content_excerpt as string) ?? null,
        (row.comment_count as number) ?? 0,
        (row.reaction_count as number) ?? 0,
        existing._id
      );
    } else {
      db.prepare(
        `INSERT INTO "${t.posts}"
           (linkedin_post_id, post_url, posted_at, content_excerpt,
            comment_count, reaction_count, last_scraped_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        (row.post_url as string) ?? null,
        (row.posted_at as number) ?? null,
        (row.content_excerpt as string) ?? null,
        (row.comment_count as number) ?? 0,
        (row.reaction_count as number) ?? 0,
        now
      );
    }
    upserted++;
  }
  return { upserted, skipped };
}

export function importCommentsJsonl(
  path: string,
  postUrl: string,
  myHandle: string | null,
  runId?: string
): { commentsInserted: number; repliesInserted: number; contactsUpserted: number } {
  const t = discoverTables();
  if (!t.contacts || !t.interactions || !t.posts) {
    return { commentsInserted: 0, repliesInserted: 0, contactsUpserted: 0 };
  }
  const db = getDb();
  const rows = readJsonl(path);
  const now = Math.floor(Date.now() / 1000);

  let commentsInserted = 0;
  let repliesInserted = 0;
  let contactsUpserted = 0;

  const insertOrUpdate = db.transaction((rows: Record<string, unknown>[]) => {
    for (const row of rows) {
      const url = (row.commenter_url as string) || "";
      const handle = (row.commenter_handle as string) || "";
      if (!url || !handle) continue;
      if (myHandle && handle.toLowerCase() === myHandle.toLowerCase()) continue;

      // Upsert contact
      const existing = db
        .prepare(`SELECT _id, tags FROM "${t.contacts}" WHERE linkedin_url = ?`)
        .get(url) as { _id: number; tags: string | null } | undefined;
      let contactId: number;
      if (existing) {
        contactId = existing._id;
        const tags = parseTags(existing.tags);
        const next = new Set(tags);
        if (row.is_first_degree) next.add("connection");
        if (next.size !== tags.length) {
          db.prepare(`UPDATE "${t.contacts}" SET tags = ?, name = COALESCE(?, name),
                       headline = COALESCE(?, headline) WHERE _id = ?`)
            .run(serializeTags(Array.from(next)),
                 (row.commenter_name as string) ?? null,
                 (row.commenter_headline as string) ?? null,
                 contactId);
        } else {
          db.prepare(`UPDATE "${t.contacts}" SET name = COALESCE(?, name),
                       headline = COALESCE(?, headline) WHERE _id = ?`)
            .run((row.commenter_name as string) ?? null,
                 (row.commenter_headline as string) ?? null, contactId);
        }
      } else {
        const tags = row.is_first_degree ? ["connection"] : [];
        const r = db.prepare(
          `INSERT INTO "${t.contacts}"
             (linkedin_url, name, headline, tags, status, first_seen, last_interaction_at)
           VALUES (?, ?, ?, ?, 'new', ?, ?)`
        ).run(
          url,
          (row.commenter_name as string) ?? null,
          (row.commenter_headline as string) ?? null,
          serializeTags(tags),
          now,
          now
        );
        contactId = Number(r.lastInsertRowid);
        contactsUpserted++;
      }

      const commentText = ((row.comment_text as string) || "").slice(0, 500);
      const ctime = parseLinkedInRelative((row.comment_time_text as string) || "") ?? now;
      const commentUrn = (row.comment_urn as string) || null;

      // Idempotency: use the comment URN (LinkedIn's unique comment ID) when available
      // — stored in `run_id` (text field, otherwise unused for scraped events).
      const dup = commentUrn
        ? db.prepare(
            `SELECT _id FROM "${t.interactions}"
             WHERE direction = 'in' AND type = 'comment' AND run_id = ?`
          ).get(`linkedin-comment-${commentUrn}`) as { _id: number } | undefined
        : db.prepare(
            `SELECT _id FROM "${t.interactions}"
             WHERE post_url = ? AND contact_db_id = ? AND direction = 'in' AND type = 'comment'
               AND substr(COALESCE(content_excerpt,''), 1, 200) = ?`
          ).get(postUrl, contactId, commentText.slice(0, 200)) as { _id: number } | undefined;

      if (!dup) {
        db.prepare(
          `INSERT INTO "${t.interactions}"
             (contact_db_id, type, direction, channel, content_excerpt, post_url,
              run_id, created_at)
           VALUES (?, 'comment', 'in', 'linkedin', ?, ?, ?, ?)`
        ).run(
          contactId,
          commentText,
          postUrl,
          commentUrn ? `linkedin-comment-${commentUrn}` : (runId ?? null),
          ctime
        );
        commentsInserted++;
        db.prepare(
          `UPDATE "${t.contacts}" SET last_interaction_at = ? WHERE _id = ?`
        ).run(ctime, contactId);
      }

      // Our reply, if any
      const ourReply = row.our_reply as { text?: string; time_text?: string; urn?: string } | null;
      if (ourReply && ourReply.text) {
        const replyText = (ourReply.text || "").slice(0, 500);
        const replyTime = parseLinkedInRelative(ourReply.time_text || "") ?? now;
        const replyUrn = ourReply.urn || null;
        const replyDup = replyUrn
          ? db.prepare(
              `SELECT _id FROM "${t.interactions}"
               WHERE direction = 'out' AND type = 'reply' AND run_id = ?`
            ).get(`linkedin-reply-${replyUrn}`) as { _id: number } | undefined
          : db.prepare(
              `SELECT _id FROM "${t.interactions}"
               WHERE post_url = ? AND contact_db_id = ? AND direction = 'out' AND type = 'reply'
                 AND substr(COALESCE(content_excerpt,''), 1, 200) = ?`
            ).get(postUrl, contactId, replyText.slice(0, 200)) as { _id: number } | undefined;
        if (!replyDup) {
          db.prepare(
            `INSERT INTO "${t.interactions}"
               (contact_db_id, type, direction, channel, content_excerpt, post_url,
                run_id, created_at, sent_at, draft_status)
             VALUES (?, 'reply', 'out', 'linkedin', ?, ?, ?, ?, ?, 'sent')`
          ).run(
            contactId,
            replyText,
            postUrl,
            replyUrn ? `linkedin-reply-${replyUrn}` : (runId ?? null),
            replyTime,
            replyTime
          );
          repliesInserted++;
        }
      }
      void contentHash; // legacy helper, kept for future use
    }
  });
  insertOrUpdate(rows);

  // Recompute post counts
  const counts = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM "${t.interactions}"
            WHERE post_url = ? AND direction='in' AND type='comment') AS total,
         (SELECT COUNT(DISTINCT contact_db_id) FROM "${t.interactions}"
            WHERE post_url = ? AND direction='out' AND type='reply') AS replied
       `
    )
    .get(postUrl, postUrl) as { total: number; replied: number };

  db.prepare(
    `UPDATE "${t.posts}" SET comment_count = ?, replied_count = ?, ignored_count = ?, last_scraped_at = ?
     WHERE post_url = ?`
  ).run(
    counts.total,
    counts.replied,
    Math.max(0, counts.total - counts.replied),
    Math.floor(Date.now() / 1000),
    postUrl
  );

  return { commentsInserted, repliesInserted, contactsUpserted };
}

export function importEnrichmentJsonl(path: string): { updated: number } {
  const t = discoverTables();
  if (!t.contacts) return { updated: 0 };
  const db = getDb();
  const rows = readJsonl(path);
  let updated = 0;
  const tx = db.transaction((rows: Record<string, unknown>[]) => {
    for (const row of rows) {
      const id = row.id as number;
      if (!Number.isFinite(id)) continue;
      const existing = db
        .prepare(`SELECT tags FROM "${t.contacts}" WHERE _id = ?`)
        .get(id) as { tags: string | null } | undefined;
      if (!existing) continue;
      const tags = parseTags(existing.tags);
      const tagSet = new Set(tags);
      tagSet.add("enriched");
      if (row.is_first_degree) tagSet.add("connection");

      // Only OVERWRITE name/headline if the existing field is empty — the
      // comment-scraper already captures clean values, and the enrichment-page
      // text extraction is noisier. We always overwrite company + location +
      // notes (raw about text), because the comment-scraper doesn't capture
      // those.
      db.prepare(
        `UPDATE "${t.contacts}"
         SET name = CASE WHEN COALESCE(name,'') = '' AND ? != '' THEN ? ELSE name END,
             headline = CASE WHEN COALESCE(headline,'') = '' AND ? != '' THEN ? ELSE headline END,
             company = COALESCE(NULLIF(?,''), company),
             notes = CASE WHEN ? != '' THEN ? ELSE notes END,
             tags = ?
         WHERE _id = ?`
      ).run(
        (row.name as string) ?? "",
        (row.name as string) ?? "",
        (row.headline as string) ?? "",
        (row.headline as string) ?? "",
        (row.company as string) ?? "",
        (row.about_excerpt as string) ?? "",
        (row.about_excerpt as string) ?? "",
        serializeTags(Array.from(tagSet)),
        id
      );
      updated++;
    }
  });
  tx(rows);
  return { updated };
}

export type EnrichTarget = { id: number; handle: string };

export function pickEnrichTargets(limit: number): EnrichTarget[] {
  const t = discoverTables();
  if (!t.contacts) return [];
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT _id, linkedin_url, COALESCE(tags,'[]') AS tags
       FROM "${t.contacts}"
       WHERE linkedin_url IS NOT NULL AND linkedin_url != ''
         AND COALESCE(tags,'') NOT LIKE '%"enriched"%'
       ORDER BY last_interaction_at DESC, _id DESC
       LIMIT ?`
    )
    .all(limit) as { _id: number; linkedin_url: string }[];

  const out: EnrichTarget[] = [];
  for (const r of rows) {
    const m = r.linkedin_url.match(/\/in\/([^/?#]+)/);
    if (m) out.push({ id: r._id, handle: m[1] });
  }
  return out;
}
