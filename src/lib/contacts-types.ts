// Shared types + constants for the CRM (/contacts, /pipeline).
// Data lives in Harbour user-databases `contacts` (table d_contacts) and
// `interactions` (table d_interactions), created in Phase B.2.

export const STATUSES = [
  "new",
  "engaged",
  "qualified",
  "customer",
  "cold",
  "do-not-contact",
] as const;
export type Status = typeof STATUSES[number];

export const STATUS_LABELS: Record<Status, string> = {
  new: "New",
  engaged: "Engaged",
  qualified: "Qualified",
  customer: "Customer",
  cold: "Cold",
  "do-not-contact": "Do Not Contact",
};

// Tailwind classes for status badges (avoid dynamic className concatenation).
export const STATUS_BADGE_CLASS: Record<Status, string> = {
  new: "bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-blue-300",
  engaged: "bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300",
  qualified: "bg-violet-500/10 text-violet-700 border-violet-500/20 dark:text-violet-300",
  customer: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300",
  cold: "bg-slate-500/10 text-slate-700 border-slate-500/20 dark:text-slate-300",
  "do-not-contact": "bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-300",
};

export const STANDARD_TAGS = [
  "connection",
  "competitor",
  "hot-lead",
  "customer",
  "newsletter-subscriber",
] as const;

export const LANGUAGES = ["da", "en"] as const;
export type Language = typeof LANGUAGES[number];

export type Contact = {
  id: number;
  linkedin_url: string | null;
  email: string | null;
  name: string | null;
  headline: string | null;
  company: string | null;
  tags: string[];
  status: Status;
  language: Language | null;
  first_seen: number | null;
  last_interaction_at: number | null;
  notes: string | null;
};

export type Interaction = {
  id: number;
  contact_db_id: number;
  type: string;
  direction: "in" | "out";
  channel: string;
  language: string | null;
  content_excerpt: string | null;
  draft_path: string | null;
  draft_status: string | null;
  post_url: string | null;
  run_id: string | null;
  created_at: number;
  sent_at: number | null;
};

export type ContactListItem = Contact & {
  interaction_count: number;
};

export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export function serializeTags(tags: string[]): string {
  return JSON.stringify(tags.filter(Boolean));
}

export function isValidStatus(s: string): s is Status {
  return (STATUSES as readonly string[]).includes(s);
}

export function isValidLinkedInUrl(url: string): boolean {
  return /^https:\/\/(www\.)?linkedin\.com\/in\/[^/?#]+\/?/.test(url.trim());
}
