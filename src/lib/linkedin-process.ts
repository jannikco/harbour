// Thin spawn helpers for the LinkedIn workflows. Lives in src/lib/ rather than
// directly in route handlers — Turbopack's static analysis mis-fires on
// `child_process.spawn("node", …)` calls inside route files but tolerates them
// in regular library modules (cf. `src/lib/video-processing.ts`).

import { spawn } from "child_process";
import type { ChildProcess } from "child_process";

/**
 * Spawns `node <scriptPath> [args…]`, capturing stdout/stderr as pipes.
 * Returns the ChildProcess so the caller can attach exit/data listeners.
 *
 * Inherits process.env (which under launchd already contains the LaunchAgent's
 * configured PATH including Playwright's chromium binaries). Caller may pass
 * `extraEnv` to override per-call.
 */
export function spawnNodeScript(
  scriptPath: string,
  args: string[] = [],
  extraEnv: Record<string, string | undefined> = {}
): ChildProcess {
  return spawn("node", [scriptPath, ...args], {
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...extraEnv },
  });
}
