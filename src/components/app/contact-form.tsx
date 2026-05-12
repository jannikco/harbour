"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import {
  STATUSES,
  STATUS_LABELS,
  STANDARD_TAGS,
  type Status,
  type Contact,
  isValidLinkedInUrl,
} from "@/lib/contacts-types";

export type ContactFormValues = {
  linkedin_url: string;
  email: string;
  name: string;
  headline: string;
  company: string;
  language: string;
  status: Status;
  tags: string[];
  notes: string;
};

export function emptyValues(): ContactFormValues {
  return {
    linkedin_url: "",
    email: "",
    name: "",
    headline: "",
    company: "",
    language: "",
    status: "new",
    tags: [],
    notes: "",
  };
}

export function valuesFromContact(c: Contact): ContactFormValues {
  return {
    linkedin_url: c.linkedin_url ?? "",
    email: c.email ?? "",
    name: c.name ?? "",
    headline: c.headline ?? "",
    company: c.company ?? "",
    language: c.language ?? "",
    status: c.status,
    tags: c.tags ?? [],
    notes: c.notes ?? "",
  };
}

export function ContactForm({
  values,
  onChange,
  onSubmit,
  submitLabel,
  submitting,
  error,
}: {
  values: ContactFormValues;
  onChange: (v: ContactFormValues) => void;
  onSubmit: () => void;
  submitLabel: string;
  submitting?: boolean;
  error?: string | null;
}) {
  const [tagInput, setTagInput] = useState("");

  const linkedInInvalid =
    values.linkedin_url.trim() !== "" && !isValidLinkedInUrl(values.linkedin_url);

  function addTag(t: string) {
    const tag = t.trim().toLowerCase();
    if (!tag) return;
    if (values.tags.includes(tag)) return;
    onChange({ ...values, tags: [...values.tags, tag] });
    setTagInput("");
  }
  function removeTag(t: string) {
    onChange({ ...values, tags: values.tags.filter((x) => x !== t) });
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (linkedInInvalid) return;
        onSubmit();
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input
            value={values.name}
            onChange={(e) => onChange({ ...values, name: e.target.value })}
            placeholder="Jannik Hansen"
          />
        </Field>
        <Field label="Company">
          <Input
            value={values.company}
            onChange={(e) => onChange({ ...values, company: e.target.value })}
            placeholder="AI BootCamp"
          />
        </Field>
        <Field label="Headline" className="sm:col-span-2">
          <Input
            value={values.headline}
            onChange={(e) => onChange({ ...values, headline: e.target.value })}
            placeholder="Founder · AI BootCamp · EU AI Act"
          />
        </Field>
        <Field label="LinkedIn URL" className="sm:col-span-2">
          <Input
            value={values.linkedin_url}
            onChange={(e) => onChange({ ...values, linkedin_url: e.target.value })}
            placeholder="https://www.linkedin.com/in/handle"
          />
          {linkedInInvalid && (
            <p className="mt-1 text-xs text-destructive">Must look like https://www.linkedin.com/in/&lt;handle&gt;</p>
          )}
        </Field>
        <Field label="Email">
          <Input
            type="email"
            value={values.email}
            onChange={(e) => onChange({ ...values, email: e.target.value })}
            placeholder="jh@example.com"
          />
        </Field>
        <Field label="Language">
          <Select
            value={values.language || "none"}
            onValueChange={(v) =>
              onChange({ ...values, language: !v || v === "none" ? "" : v })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Pick language" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              <SelectItem value="da">Danish</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Status">
          <Select
            value={values.status}
            onValueChange={(v) => {
              if (v) onChange({ ...values, status: v as Status });
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Tags" className="sm:col-span-2">
          <div className="flex flex-wrap gap-1">
            {values.tags.map((t) => (
              <Badge
                key={t}
                variant="secondary"
                className="cursor-pointer gap-1"
                onClick={() => removeTag(t)}
              >
                {t}
                <X className="h-3 w-3" />
              </Badge>
            ))}
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag(tagInput);
                }
                if (e.key === "Backspace" && !tagInput && values.tags.length) {
                  removeTag(values.tags[values.tags.length - 1]);
                }
              }}
              placeholder="add a tag, press Enter"
              className="h-7 max-w-[200px]"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1 text-xs text-muted-foreground">
            <span>Common:</span>
            {STANDARD_TAGS.map((t) => (
              <button
                key={t}
                type="button"
                className={`rounded px-1.5 py-0.5 hover:bg-accent ${
                  values.tags.includes(t) ? "opacity-30" : ""
                }`}
                onClick={() => addTag(t)}
                disabled={values.tags.includes(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea
            value={values.notes}
            onChange={(e) => onChange({ ...values, notes: e.target.value })}
            placeholder="What you know about them, decisions, observations…"
            rows={3}
          />
        </Field>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end">
        <Button type="submit" disabled={submitting || linkedInInvalid}>
          {submitting ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
