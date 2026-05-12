// Query helpers for the user-created `contacts` and `interactions` Harbour
// databases. We bypass Harbour's generic /api/databases endpoints because the
// /contacts and /pipeline UIs need richer queries (filters, joins, counts).

import { getDb } from "./db/schema";
import {
  type Contact,
  type ContactListItem,
  type Interaction,
  type Status,
  parseTags,
  serializeTags,
  isValidStatus,
} from "./contacts-types";

type Tables = { contacts: string | null; interactions: string | null };

function discoverTables(): Tables {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT name, table_name FROM databases WHERE name IN ('contacts', 'interactions')`
    )
    .all() as { name: string; table_name: string }[];
  let contacts: string | null = null;
  let interactions: string | null = null;
  for (const r of rows) {
    if (r.name === "contacts") contacts = r.table_name;
    if (r.name === "interactions") interactions = r.table_name;
  }
  return { contacts, interactions };
}

function rowToContact(row: Record<string, unknown>): Contact {
  return {
    id: row._id as number,
    linkedin_url: (row.linkedin_url as string) ?? null,
    email: (row.email as string) ?? null,
    name: (row.name as string) ?? null,
    headline: (row.headline as string) ?? null,
    company: (row.company as string) ?? null,
    tags: parseTags(row.tags as string | null),
    status: ((row.status as string) || "new") as Status,
    language: (row.language as Contact["language"]) ?? null,
    first_seen: (row.first_seen as number) ?? null,
    last_interaction_at: (row.last_interaction_at as number) ?? null,
    notes: (row.notes as string) ?? null,
  };
}

function rowToInteraction(row: Record<string, unknown>): Interaction {
  return {
    id: row._id as number,
    contact_db_id: row.contact_db_id as number,
    type: row.type as string,
    direction: row.direction as "in" | "out",
    channel: row.channel as string,
    language: (row.language as string) ?? null,
    content_excerpt: (row.content_excerpt as string) ?? null,
    draft_path: (row.draft_path as string) ?? null,
    draft_status: (row.draft_status as string) ?? null,
    post_url: (row.post_url as string) ?? null,
    run_id: (row.run_id as string) ?? null,
    created_at: row.created_at as number,
    sent_at: (row.sent_at as number) ?? null,
  };
}

export type ListFilters = {
  status?: Status;
  tag?: string;
  language?: string;
  query?: string;
  limit?: number;
  offset?: number;
  orderBy?: "last_interaction_at" | "name" | "status" | "first_seen";
  order?: "ASC" | "DESC";
};

export function listContacts(filters: ListFilters = {}): {
  rows: ContactListItem[];
  total: number;
} {
  const { contacts, interactions } = discoverTables();
  if (!contacts) return { rows: [], total: 0 };

  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.status && isValidStatus(filters.status)) {
    where.push(`c.status = ?`);
    params.push(filters.status);
  }
  if (filters.tag) {
    // tags is JSON array text; LIKE check is best-effort.
    where.push(`c.tags LIKE ?`);
    params.push(`%"${filters.tag}"%`);
  }
  if (filters.language) {
    where.push(`c.language = ?`);
    params.push(filters.language);
  }
  if (filters.query) {
    where.push(`(c.name LIKE ? OR c.headline LIKE ? OR c.company LIKE ?)`);
    const q = `%${filters.query}%`;
    params.push(q, q, q);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const orderBy = filters.orderBy ?? "last_interaction_at";
  const order = filters.order ?? "DESC";
  const orderSql = `ORDER BY c.${orderBy} ${order}, c._id DESC`;

  const limit = Math.max(1, Math.min(500, filters.limit ?? 50));
  const offset = Math.max(0, filters.offset ?? 0);

  const db = getDb();

  const countSql = `SELECT COUNT(*) as c FROM "${contacts}" c ${whereSql}`;
  const total = (db.prepare(countSql).get(...params) as { c: number }).c;

  const interactionsJoin = interactions
    ? `LEFT JOIN (
         SELECT contact_db_id, COUNT(*) AS cnt
         FROM "${interactions}"
         GROUP BY contact_db_id
       ) ix ON ix.contact_db_id = c._id`
    : "";
  const interactionCol = interactions ? `COALESCE(ix.cnt, 0)` : `0`;

  const listSql = `
    SELECT c._id, c.linkedin_url, c.email, c.name, c.headline, c.company,
           c.tags, c.status, c.language, c.first_seen, c.last_interaction_at, c.notes,
           ${interactionCol} AS interaction_count
    FROM "${contacts}" c
    ${interactionsJoin}
    ${whereSql}
    ${orderSql}
    LIMIT ? OFFSET ?
  `;
  const rows = db.prepare(listSql).all(...params, limit, offset) as Record<
    string,
    unknown
  >[];

  return {
    rows: rows.map((r) => ({
      ...rowToContact(r),
      interaction_count: (r.interaction_count as number) ?? 0,
    })),
    total,
  };
}

export function getContact(id: number): {
  contact: Contact;
  interactions: Interaction[];
} | null {
  const { contacts, interactions } = discoverTables();
  if (!contacts) return null;
  const db = getDb();

  const row = db
    .prepare(
      `SELECT _id, linkedin_url, email, name, headline, company, tags, status,
              language, first_seen, last_interaction_at, notes
       FROM "${contacts}" WHERE _id = ?`
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;

  let interactionsList: Interaction[] = [];
  if (interactions) {
    const irows = db
      .prepare(
        `SELECT _id, contact_db_id, type, direction, channel, language,
                content_excerpt, draft_path, draft_status, post_url, run_id,
                created_at, sent_at
         FROM "${interactions}"
         WHERE contact_db_id = ?
         ORDER BY created_at DESC
         LIMIT 500`
      )
      .all(id) as Record<string, unknown>[];
    interactionsList = irows.map(rowToInteraction);
  }
  return { contact: rowToContact(row), interactions: interactionsList };
}

export type CreateContactInput = {
  linkedin_url?: string | null;
  email?: string | null;
  name?: string | null;
  headline?: string | null;
  company?: string | null;
  tags?: string[];
  status?: Status;
  language?: string | null;
  notes?: string | null;
};

export function createContact(input: CreateContactInput): Contact | null {
  const { contacts } = discoverTables();
  if (!contacts) return null;
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const status: Status = input.status && isValidStatus(input.status) ? input.status : "new";

  const result = db
    .prepare(
      `INSERT INTO "${contacts}"
         (linkedin_url, email, name, headline, company, tags, status, language,
          first_seen, last_interaction_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.linkedin_url ?? null,
      input.email ?? null,
      input.name ?? null,
      input.headline ?? null,
      input.company ?? null,
      serializeTags(input.tags ?? []),
      status,
      input.language ?? null,
      now,
      null,
      input.notes ?? null
    );

  return getContact(Number(result.lastInsertRowid))?.contact ?? null;
}

export type UpdateContactInput = Partial<CreateContactInput> & {
  last_interaction_at?: number | null;
};

const UPDATABLE: (keyof UpdateContactInput)[] = [
  "linkedin_url",
  "email",
  "name",
  "headline",
  "company",
  "tags",
  "status",
  "language",
  "notes",
  "last_interaction_at",
];

export function updateContact(id: number, input: UpdateContactInput): Contact | null {
  const { contacts } = discoverTables();
  if (!contacts) return null;
  const db = getDb();

  const sets: string[] = [];
  const values: unknown[] = [];
  for (const key of UPDATABLE) {
    if (input[key] === undefined) continue;
    if (key === "tags") {
      sets.push(`tags = ?`);
      values.push(serializeTags((input.tags ?? []) as string[]));
    } else if (key === "status") {
      if (!input.status || !isValidStatus(input.status)) continue;
      sets.push(`status = ?`);
      values.push(input.status);
    } else {
      sets.push(`${key} = ?`);
      values.push((input as Record<string, unknown>)[key] ?? null);
    }
  }
  if (!sets.length) return getContact(id)?.contact ?? null;

  values.push(id);
  db.prepare(`UPDATE "${contacts}" SET ${sets.join(", ")} WHERE _id = ?`).run(...values);
  return getContact(id)?.contact ?? null;
}

export function deleteContact(id: number): boolean {
  const { contacts, interactions } = discoverTables();
  if (!contacts) return false;
  const db = getDb();
  // Delete interactions first to keep things tidy.
  if (interactions) {
    db.prepare(`DELETE FROM "${interactions}" WHERE contact_db_id = ?`).run(id);
  }
  const r = db.prepare(`DELETE FROM "${contacts}" WHERE _id = ?`).run(id);
  return r.changes > 0;
}

export function listByStatus(status: Status, limit = 200): ContactListItem[] {
  return listContacts({ status, limit, orderBy: "last_interaction_at", order: "DESC" }).rows;
}

export function listAllForPipeline(): Record<Status, ContactListItem[]> {
  const { contacts, interactions } = discoverTables();
  const empty: Record<Status, ContactListItem[]> = {
    new: [],
    engaged: [],
    qualified: [],
    customer: [],
    cold: [],
    "do-not-contact": [],
  };
  if (!contacts) return empty;

  const db = getDb();
  const interactionsJoin = interactions
    ? `LEFT JOIN (
         SELECT contact_db_id, COUNT(*) AS cnt
         FROM "${interactions}" GROUP BY contact_db_id
       ) ix ON ix.contact_db_id = c._id`
    : "";
  const interactionCol = interactions ? `COALESCE(ix.cnt, 0)` : `0`;

  const rows = db
    .prepare(
      `SELECT c._id, c.linkedin_url, c.email, c.name, c.headline, c.company,
              c.tags, c.status, c.language, c.first_seen, c.last_interaction_at, c.notes,
              ${interactionCol} AS interaction_count
       FROM "${contacts}" c
       ${interactionsJoin}
       ORDER BY c.last_interaction_at DESC, c._id DESC
       LIMIT 2000`
    )
    .all() as Record<string, unknown>[];

  const result = { ...empty };
  for (const r of rows) {
    const c: ContactListItem = {
      ...rowToContact(r),
      interaction_count: (r.interaction_count as number) ?? 0,
    };
    if (isValidStatus(c.status)) {
      result[c.status].push(c);
    } else {
      result.new.push(c);
    }
  }
  return result;
}
