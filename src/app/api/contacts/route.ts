import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import {
  listContacts,
  createContact,
  type ListFilters,
} from "@/lib/contacts-db";
import { isValidStatus, isValidLinkedInUrl } from "@/lib/contacts-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req) => {
  const url = new URL(req.url);
  const filters: ListFilters = {
    query: url.searchParams.get("q") || undefined,
    tag: url.searchParams.get("tag") || undefined,
    language: url.searchParams.get("language") || undefined,
    limit: parseInt(url.searchParams.get("limit") || "50", 10) || 50,
    offset: parseInt(url.searchParams.get("offset") || "0", 10) || 0,
  };
  const status = url.searchParams.get("status");
  if (status && isValidStatus(status)) filters.status = status;

  const orderBy = url.searchParams.get("orderBy");
  if (
    orderBy === "last_interaction_at" ||
    orderBy === "name" ||
    orderBy === "status" ||
    orderBy === "first_seen"
  ) {
    filters.orderBy = orderBy;
  }
  const order = url.searchParams.get("order");
  if (order === "ASC" || order === "DESC") filters.order = order;

  const { rows, total } = listContacts(filters);
  return NextResponse.json({ contacts: rows, total, limit: filters.limit, offset: filters.offset });
});

export const POST = withAuth(async (req) => {
  const body = await req.json().catch(() => ({}));

  // LinkedIn URL is the primary handle but optional (someone might exist only as an email contact).
  if (body.linkedin_url && !isValidLinkedInUrl(body.linkedin_url)) {
    return NextResponse.json(
      { error: "linkedin_url must look like https://www.linkedin.com/in/<handle>" },
      { status: 400 }
    );
  }
  if (!body.name && !body.linkedin_url && !body.email) {
    return NextResponse.json(
      { error: "At least one of name, linkedin_url, or email is required" },
      { status: 400 }
    );
  }

  const contact = createContact({
    linkedin_url: body.linkedin_url ?? null,
    email: body.email ?? null,
    name: body.name ?? null,
    headline: body.headline ?? null,
    company: body.company ?? null,
    tags: Array.isArray(body.tags) ? body.tags : [],
    status: isValidStatus(body.status) ? body.status : "new",
    language: body.language ?? null,
    notes: body.notes ?? null,
  });

  if (!contact) {
    return NextResponse.json(
      { error: "contacts database not found (run Phase B.2 setup)" },
      { status: 500 }
    );
  }
  return NextResponse.json(contact, { status: 201 });
});
