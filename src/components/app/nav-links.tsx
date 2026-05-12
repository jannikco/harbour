"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "./app-context";
import {
  Activity,
  Briefcase,
  Bot,
  FileText,
  Database,
  KeyRound,
  Users,
  Settings,
  MessageSquare,
  Contact as ContactIcon,
  Kanban,
  Newspaper,
  Mail,
} from "lucide-react";
import { LinkedInIcon } from "./linkedin-icon";

export function NavLinks({ onClick }: { onClick?: () => void }) {
  const pathname = usePathname();
  const { waitingCount } = useApp();
  const [dmQueueCount, setDmQueueCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/dms?limit=200");
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        const count = (j.threads || []).reduce(
          (acc: number, t: { approved_drafts?: number }) => acc + (t.approved_drafts || 0),
          0,
        );
        setDmQueueCount(count);
      } catch {
        // ignore
      }
    }
    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const links = [
    { href: "/captain", label: "Captain", icon: MessageSquare },
    { href: "/", label: "Runs", icon: Activity, badge: waitingCount },
    { href: "/jobs", label: "Jobs", icon: Briefcase },
    { href: "/agents", label: "Agents", icon: Bot },
    { href: "/docs", label: "Docs", icon: FileText },
    { href: "/databases", label: "Databases", icon: Database },
    { href: "/contacts", label: "Contacts", icon: ContactIcon },
    { href: "/pipeline", label: "Pipeline", icon: Kanban },
    { href: "/posts", label: "Posts", icon: Newspaper },
    { href: "/dms", label: "DMs", icon: Mail, badge: dmQueueCount },
    { href: "/env-vars", label: "Env Vars", icon: KeyRound },
    { href: "/linkedin", label: "LinkedIn", icon: LinkedInIcon },
    { href: "/users", label: "Users", icon: Users },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <nav className="flex flex-col gap-0.5 px-2">
      {links.map((link) => {
        const isActive = link.href === "/"
          ? pathname === "/" || pathname.startsWith("/runs")
          : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={onClick}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <link.icon className="h-4 w-4" />
            {link.label}
            {"badge" in link && (link.badge ?? 0) > 0 && (
              <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-medium leading-none text-primary-foreground">
                {link.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
