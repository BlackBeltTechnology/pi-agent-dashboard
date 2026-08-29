/**
 * pi extension: capture the real outgoing provider payload once per session.
 *
 * `before_provider_request` fires after the provider payload is built and
 * before it is sent, so what we record is exactly what the model receives —
 * not a reconstruction. Returning undefined leaves the payload untouched; this
 * extension only observes.
 *
 * Env:
 *   CONTEXT_BUDGET_OUT   where to write the capture (default: ./context-budget.json)
 *   CONTEXT_BUDGET_DROP  comma-separated tool names to deactivate before measuring
 */

import { writeFileSync } from "node:fs";
import { analyzePayload } from "./analyze.js";

// Structural type: avoids a hard dependency on the pi SDK's ExtensionAPI, which
// is an optional peer here.
interface MeterApi {
  on(event: string, handler: (event: unknown, ctx: unknown) => void): void;
  getActiveTools?(): string[];
  setActiveTools?(names: string[]): void;
}

export default function (pi: MeterApi): void {
  const out = process.env.CONTEXT_BUDGET_OUT ?? "./context-budget.json";
  const drop = (process.env.CONTEXT_BUDGET_DROP ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let captured = false;

  pi.on("session_start", () => {
    if (drop.length === 0) return;
    const active = pi.getActiveTools?.() ?? [];
    pi.setActiveTools?.(active.filter((n) => !drop.includes(n)));
  });

  pi.on("before_provider_request", (event: unknown) => {
    if (captured) return;
    captured = true;

    const payload = (event as { payload?: unknown } | undefined)?.payload;
    const breakdown = analyzePayload(payload);

    writeFileSync(out, `${JSON.stringify({ capturedAt: new Date().toISOString(), dropped: drop, breakdown }, null, 2)}\n`);
  });
}
