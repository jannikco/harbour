import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import {
  readLimits,
  writeLimits,
  computeUsage,
  readConnectionsSyncInfo,
  DEFAULT_LIMITS,
  type LinkedInLimits,
} from "@/lib/linkedin-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  const config = readLimits();
  const usage = computeUsage();
  const sync = readConnectionsSyncInfo();
  return NextResponse.json({ config, usage, connectionsSyncedAt: sync.lastSyncedAt });
});

const numericKeys: (keyof LinkedInLimits)[] = [
  "maxDmsPerDay",
  "maxCommentsNonContactPerDay",
  "maxCommentsContactPerDay",
  "spreadHours",
  "minSecondsBetweenActions",
  "dmRewriteVariations",
  "maxWritesPerHour",
  "activeHoursStart",
  "activeHoursEnd",
  "jitterMinSeconds",
  "jitterMaxSeconds",
  "burstSize",
  "burstBreakMinSeconds",
  "burstBreakMaxSeconds",
  "cronJitterMaxSeconds",
];

const booleanKeys: (keyof LinkedInLimits)[] = ["useExtensionForSend"];

export const PUT = withAuth(async (req) => {
  const body = await req.json().catch(() => ({}));
  const patch: Partial<LinkedInLimits> = {};
  for (const key of numericKeys) {
    if (body[key] === undefined) continue;
    const n = Number(body[key]);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json(
        { error: `${key} must be a non-negative number` },
        { status: 400 }
      );
    }
    // Sane upper bounds to prevent finger-slip disasters.
    const caps: Partial<Record<keyof LinkedInLimits, number>> = {
      maxDmsPerDay: 500,
      maxCommentsNonContactPerDay: 200,
      maxCommentsContactPerDay: 200,
      spreadHours: 24,
      minSecondsBetweenActions: 3600,
      dmRewriteVariations: 50,
      maxWritesPerHour: 100,
      activeHoursStart: 23,
      activeHoursEnd: 23,
      jitterMinSeconds: 300,
      jitterMaxSeconds: 600,
      burstSize: 20,
      burstBreakMinSeconds: 3600,
      burstBreakMaxSeconds: 7200,
      cronJitterMaxSeconds: 1800,
    };
    const max = caps[key] ?? Infinity;
    if (n > max) {
      return NextResponse.json(
        { error: `${key} cannot exceed ${max}` },
        { status: 400 }
      );
    }
    patch[key] = n as never;
  }
  for (const key of booleanKeys) {
    if (body[key] === undefined) continue;
    patch[key] = (!!body[key]) as never;
  }

  const next = writeLimits(patch);
  return NextResponse.json({ config: next });
});

// Defaults exposed for tests / UI bootstrap.
export const POST = withAuth(async () => {
  return NextResponse.json({ defaults: DEFAULT_LIMITS });
});
