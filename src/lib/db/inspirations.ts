import { getDb } from "./schema";
import { v4 as uuid } from "uuid";

export type InspirationStatus = "queued" | "processing" | "done" | "failed";

export type InspirationPost = {
  id: string;
  url: string;
  status: InspirationStatus;
  source_author: string | null;
  source_author_url: string | null;
  source_posted_at_text: string | null;
  source_text: string | null;
  source_image_urls: string[] | null;
  source_reactions: number | null;
  source_comments: number | null;
  analysis: string | null;
  post_draft: string | null;
  reply_draft: string | null;
  topic_ideas: string[] | null;
  run_id: string | null;
  error: string | null;
  created_by_type: string | null;
  created_by_id: string | null;
  created_at: number;
  updated_at: number;
};

function rowToInspiration(row: Record<string, unknown> | undefined): InspirationPost | null {
  if (!row) return null;
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id),
    url: String(r.url),
    status: r.status as InspirationStatus,
    source_author: (r.source_author as string) ?? null,
    source_author_url: (r.source_author_url as string) ?? null,
    source_posted_at_text: (r.source_posted_at_text as string) ?? null,
    source_text: (r.source_text as string) ?? null,
    source_image_urls: parseJsonArray(r.source_image_urls),
    source_reactions: (r.source_reactions as number) ?? null,
    source_comments: (r.source_comments as number) ?? null,
    analysis: (r.analysis as string) ?? null,
    post_draft: (r.post_draft as string) ?? null,
    reply_draft: (r.reply_draft as string) ?? null,
    topic_ideas: parseJsonArray(r.topic_ideas),
    run_id: (r.run_id as string) ?? null,
    error: (r.error as string) ?? null,
    created_by_type: (r.created_by_type as string) ?? null,
    created_by_id: (r.created_by_id as string) ?? null,
    created_at: Number(r.created_at),
    updated_at: Number(r.updated_at),
  };
}

function parseJsonArray(value: unknown): string[] | null {
  if (!value || typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch {
    return null;
  }
}

export function createInspirationPost(
  url: string,
  authorType?: string,
  authorId?: string,
): InspirationPost {
  const db = getDb();
  const id = uuid();
  db.prepare(
    `INSERT INTO inspiration_posts (id, url, created_by_type, created_by_id) VALUES (?, ?, ?, ?)`,
  ).run(id, url, authorType || null, authorId || null);
  return getInspirationPost(id)!;
}

export function bulkCreateInspirationPosts(
  urls: string[],
  authorType?: string,
  authorId?: string,
): InspirationPost[] {
  const db = getDb();
  const created: InspirationPost[] = [];
  const insert = db.prepare(
    `INSERT INTO inspiration_posts (id, url, created_by_type, created_by_id) VALUES (?, ?, ?, ?)`,
  );
  const tx = db.transaction((items: string[]) => {
    for (const url of items) {
      const id = uuid();
      insert.run(id, url, authorType || null, authorId || null);
      created.push(getInspirationPost(id)!);
    }
  });
  tx(urls);
  return created;
}

export function getInspirationPost(id: string): InspirationPost | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM inspiration_posts WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return rowToInspiration(row);
}

export function listInspirationPosts(opts: {
  status?: InspirationStatus;
  projectId?: string;
  limit?: number;
  offset?: number;
} = {}): InspirationPost[] {
  const db = getDb();
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (opts.status) {
    conditions.push(`status = ?`);
    values.push(opts.status);
  }
  if (opts.projectId) {
    conditions.push(`id IN (SELECT inspiration_post_id FROM project_inspiration_posts WHERE project_id = ?)`);
    values.push(opts.projectId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts.limit ?? 200;
  const offset = opts.offset ?? 0;

  const rows = db
    .prepare(`SELECT * FROM inspiration_posts ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...values, limit, offset) as Record<string, unknown>[];
  return rows.map((r) => rowToInspiration(r)!);
}

export function updateInspirationPost(
  id: string,
  patch: Partial<{
    status: InspirationStatus;
    source_author: string | null;
    source_author_url: string | null;
    source_posted_at_text: string | null;
    source_text: string | null;
    source_image_urls: string[] | null;
    source_reactions: number | null;
    source_comments: number | null;
    analysis: string | null;
    post_draft: string | null;
    reply_draft: string | null;
    topic_ideas: string[] | null;
    run_id: string | null;
    error: string | null;
  }>,
): InspirationPost | null {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (patch.status !== undefined) { fields.push("status = ?"); values.push(patch.status); }
  if (patch.source_author !== undefined) { fields.push("source_author = ?"); values.push(patch.source_author); }
  if (patch.source_author_url !== undefined) { fields.push("source_author_url = ?"); values.push(patch.source_author_url); }
  if (patch.source_posted_at_text !== undefined) { fields.push("source_posted_at_text = ?"); values.push(patch.source_posted_at_text); }
  if (patch.source_text !== undefined) { fields.push("source_text = ?"); values.push(patch.source_text); }
  if (patch.source_image_urls !== undefined) {
    fields.push("source_image_urls = ?");
    values.push(patch.source_image_urls === null ? null : JSON.stringify(patch.source_image_urls));
  }
  if (patch.source_reactions !== undefined) { fields.push("source_reactions = ?"); values.push(patch.source_reactions); }
  if (patch.source_comments !== undefined) { fields.push("source_comments = ?"); values.push(patch.source_comments); }
  if (patch.analysis !== undefined) { fields.push("analysis = ?"); values.push(patch.analysis); }
  if (patch.post_draft !== undefined) { fields.push("post_draft = ?"); values.push(patch.post_draft); }
  if (patch.reply_draft !== undefined) { fields.push("reply_draft = ?"); values.push(patch.reply_draft); }
  if (patch.topic_ideas !== undefined) {
    fields.push("topic_ideas = ?");
    values.push(patch.topic_ideas === null ? null : JSON.stringify(patch.topic_ideas));
  }
  if (patch.run_id !== undefined) { fields.push("run_id = ?"); values.push(patch.run_id); }
  if (patch.error !== undefined) { fields.push("error = ?"); values.push(patch.error); }

  if (fields.length === 0) return getInspirationPost(id);

  fields.push("updated_at = unixepoch()");
  values.push(id);

  db.prepare(`UPDATE inspiration_posts SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getInspirationPost(id);
}

export function setInspirationRun(id: string, runId: string | null) {
  const db = getDb();
  db.prepare(`UPDATE inspiration_posts SET run_id = ?, updated_at = unixepoch() WHERE id = ?`).run(runId, id);
}

export function deleteInspirationPost(id: string) {
  const db = getDb();
  db.prepare(`DELETE FROM inspiration_posts WHERE id = ?`).run(id);
}

export function resetInspirationPost(id: string): InspirationPost | null {
  const db = getDb();
  db.prepare(
    `UPDATE inspiration_posts SET
      status = 'queued',
      error = NULL,
      analysis = NULL,
      post_draft = NULL,
      reply_draft = NULL,
      topic_ideas = NULL,
      updated_at = unixepoch()
    WHERE id = ?`,
  ).run(id);
  return getInspirationPost(id);
}

export function findInspirationByUrl(url: string): InspirationPost | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM inspiration_posts WHERE url = ? ORDER BY created_at DESC LIMIT 1`).get(url) as
    | Record<string, unknown>
    | undefined;
  return rowToInspiration(row);
}
