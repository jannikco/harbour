"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Trash2, ChevronLeft, ShieldX, Save } from "lucide-react";
import {
  ContactForm,
  valuesFromContact,
  type ContactFormValues,
} from "@/components/app/contact-form";
import { ContactTimeline } from "@/components/app/contact-timeline";
import {
  STATUS_BADGE_CLASS,
  STATUS_LABELS,
  type Contact,
  type Interaction,
} from "@/lib/contacts-types";

type Resp = {
  contact: Contact;
  interactions: Interaction[];
};

export default function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<Resp | null>(null);
  const [values, setValues] = useState<ContactFormValues | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  async function load() {
    try {
      const r = await fetch(`/api/contacts/${id}`);
      if (r.status === 404) {
        setNotFound(true);
        return;
      }
      const j = (await r.json()) as Resp;
      setData(j);
      setValues(valuesFromContact(j.contact));
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function save() {
    if (!values) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/contacts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linkedin_url: values.linkedin_url || null,
          email: values.email || null,
          name: values.name || null,
          headline: values.headline || null,
          company: values.company || null,
          language: values.language || null,
          status: values.status,
          tags: values.tags,
          notes: values.notes || null,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error || "Save failed");
      } else {
        setSavedAt(Date.now());
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  async function markDoNotContact() {
    if (!values) return;
    if (!confirm("Mark this contact as Do Not Contact? Status changes and the tag is added.")) return;
    const next: ContactFormValues = {
      ...values,
      status: "do-not-contact",
      tags: Array.from(new Set([...values.tags, "do-not-contact"])),
    };
    setValues(next);
    setTimeout(save, 50);
  }

  async function destroy() {
    if (!confirm("Delete this contact and all their interactions? Cannot be undone.")) return;
    const r = await fetch(`/api/contacts/${id}`, { method: "DELETE" });
    if (r.ok) router.push("/contacts");
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-sm">
        <Link href="/contacts" className="text-muted-foreground hover:text-foreground">
          ← back to contacts
        </Link>
        <p className="mt-6">Contact not found.</p>
      </div>
    );
  }

  if (!data || !values) {
    return <div className="p-6 text-sm text-muted-foreground">loading…</div>;
  }

  const c = data.contact;
  const initials =
    (c.name || c.linkedin_url || "?")
      .split(" ")
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <Link
        href="/contacts"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Contacts
      </Link>

      <header className="rounded-lg border bg-card p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold">{c.name || "(unnamed)"}</h1>
            {c.headline && (
              <p className="mt-0.5 truncate text-sm text-muted-foreground">{c.headline}</p>
            )}
            {c.company && (
              <p className="mt-0.5 truncate text-sm text-muted-foreground">@ {c.company}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={STATUS_BADGE_CLASS[c.status]}>
                {STATUS_LABELS[c.status]}
              </Badge>
              {c.tags.map((t) => (
                <Badge key={t} variant="secondary">
                  {t}
                </Badge>
              ))}
              {c.language && (
                <Badge variant="outline" className="text-xs">
                  {c.language}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {c.linkedin_url && (
              <a
                href={c.linkedin_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent"
              >
                <ExternalLink className="h-4 w-4" /> Open in LinkedIn
              </a>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={markDoNotContact}
              disabled={c.status === "do-not-contact"}
            >
              <ShieldX className="h-4 w-4" /> Do not contact
            </Button>
            <Button variant="ghost" size="sm" className="gap-2 text-destructive hover:text-destructive" onClick={destroy}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </div>
        </div>
      </header>

      <section className="rounded-lg border bg-card p-5">
        <h2 className="mb-3 text-sm font-medium">Edit</h2>
        <ContactForm
          values={values}
          onChange={setValues}
          onSubmit={save}
          submitLabel={
            saving
              ? "Saving…"
              : savedAt && Date.now() - savedAt < 3000
              ? "Saved ✓"
              : "Save changes"
          }
          submitting={saving}
          error={error}
        />
      </section>

      <section>
        {(() => {
          // Hide drafter "no-reply" decision-log entries — they're audit
          // trail (agent considered the thread and chose not to draft)
          // and render visually identical to a real outbound message,
          // confusing users into thinking a message is scheduled.
          const visible = data.interactions.filter(
            (it) => !(it.type === "reply" && it.draft_status === "no-reply"),
          );
          return (
            <>
              <h2 className="mb-3 text-sm font-medium">
                Timeline · {visible.length} interaction
                {visible.length === 1 ? "" : "s"}
              </h2>
              <ContactTimeline interactions={visible} />
            </>
          );
        })()}
      </section>
    </div>
  );
}
