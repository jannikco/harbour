// Scoped API keys for the Harbour Chrome extension. Issued from the
// /linkedin settings page, used by the extension's background service worker
// to authenticate cookie-sync + action-proxy requests. Narrowly scoped — auth
// middleware only honors these on /api/linkedin/session-sync and
// /api/linkedin/extension/* routes.

import { getDb } from "./schema";
import { v4 as uuid } from "uuid";
import crypto from "crypto";

function generateExtensionApiKey(): string {
  return "hbr_ext_" + crypto.randomBytes(32).toString("hex");
}

function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function createExtensionApiKey(name: string, createdByUserId: string) {
  const db = getDb();
  const id = uuid();
  const apiKey = generateExtensionApiKey();
  const apiKeyHash = hashApiKey(apiKey);
  db.prepare(
    `INSERT INTO extension_api_keys (id, name, api_key_hash, created_by_user_id) VALUES (?, ?, ?, ?)`
  ).run(id, name, apiKeyHash, createdByUserId);
  return { id, name, apiKey };
}

export function listExtensionApiKeys() {
  const db = getDb();
  return db.prepare(
    `SELECT k.id, k.name, k.last_used_at, k.last_synced_at, k.created_at, u.display_name as created_by
     FROM extension_api_keys k
     JOIN users u ON k.created_by_user_id = u.id
     ORDER BY k.created_at DESC`
  ).all();
}

export function deleteExtensionApiKey(id: string) {
  const db = getDb();
  db.prepare(`DELETE FROM extension_api_keys WHERE id = ?`).run(id);
}

export function authenticateExtensionApiKey(apiKey: string) {
  const db = getDb();
  const hash = hashApiKey(apiKey);
  const row = db.prepare(
    `SELECT k.id, k.name, k.created_by_user_id, u.email, u.display_name
     FROM extension_api_keys k
     JOIN users u ON k.created_by_user_id = u.id
     WHERE k.api_key_hash = ?`
  ).get(hash) as { id: string; name: string; created_by_user_id: string; email: string; display_name: string } | undefined;
  if (row) {
    db.prepare(`UPDATE extension_api_keys SET last_used_at = unixepoch() WHERE id = ?`).run(row.id);
  }
  return row || null;
}

export function markExtensionSynced(id: string) {
  const db = getDb();
  db.prepare(`UPDATE extension_api_keys SET last_synced_at = unixepoch() WHERE id = ?`).run(id);
}

// Most-recent sync time across all extension keys — used by the UI for the
// "Browser session synced N min ago" indicator.
export function getLatestExtensionSync(): number | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT MAX(last_synced_at) AS t FROM extension_api_keys`
  ).get() as { t: number | null };
  return row?.t ?? null;
}
