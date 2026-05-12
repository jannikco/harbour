"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Search } from "lucide-react";
import { ContactTable } from "@/components/app/contact-table";
import {
  ContactForm,
  emptyValues,
  type ContactFormValues,
} from "@/components/app/contact-form";
import {
  STATUSES,
  STATUS_LABELS,
  STANDARD_TAGS,
  type ContactListItem,
} from "@/lib/contacts-types";

type ApiResp = {
  contacts: ContactListItem[];
  total: number;
  limit: number;
  offset: number;
};

export default function ContactsPage() {
  const [resp, setResp] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [values, setValues] = useState<ContactFormValues>(emptyValues());

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("any");
  const [tag, setTag] = useState<string>("any");
  const [language, setLanguage] = useState<string>("any");

  async function refresh() {
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status !== "any") params.set("status", status);
    if (tag !== "any") params.set("tag", tag);
    if (language !== "any") params.set("language", language);
    params.set("limit", "100");
    try {
      const r = await fetch(`/api/contacts?${params.toString()}`);
      const j = (await r.json()) as ApiResp;
      setResp(j);
    } catch {
      setResp({ contacts: [], total: 0, limit: 50, offset: 0 });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // debounce filter changes
  useEffect(() => {
    const id = setTimeout(refresh, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status, tag, language]);

  async function createOne() {
    setCreating(true);
    setCreateError(null);
    try {
      const r = await fetch("/api/contacts", {
        method: "POST",
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
        setCreateError(j.error || "Failed");
      } else {
        setOpen(false);
        setValues(emptyValues());
        await refresh();
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Contacts</h1>
          <p className="text-sm text-muted-foreground">
            People we&apos;ve touched on LinkedIn — DMs, comments, replies, scrapes.
            {resp ? <> <span className="ml-2">{resp.total} total</span></> : null}
          </p>
        </div>
        <Button className="gap-2" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          Add contact
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-[640px]">
            <DialogHeader>
              <DialogTitle>New contact</DialogTitle>
            </DialogHeader>
            <ContactForm
              values={values}
              onChange={setValues}
              onSubmit={createOne}
              submitLabel="Create"
              submitting={creating}
              error={createError}
            />
          </DialogContent>
        </Dialog>
      </header>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_180px_180px_140px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, headline, company…"
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v ?? "any")}>
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any status</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tag} onValueChange={(v) => setTag(v ?? "any")}>
          <SelectTrigger>
            <SelectValue placeholder="Tag" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any tag</SelectItem>
            {STANDARD_TAGS.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={language} onValueChange={(v) => setLanguage(v ?? "any")}>
          <SelectTrigger>
            <SelectValue placeholder="Language" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any language</SelectItem>
            <SelectItem value="da">Danish</SelectItem>
            <SelectItem value="en">English</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading && !resp ? (
        <div className="text-sm text-muted-foreground">loading…</div>
      ) : (
        <ContactTable contacts={resp?.contacts ?? []} />
      )}
    </div>
  );
}
