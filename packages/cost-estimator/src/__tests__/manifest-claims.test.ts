/**
 * Manifest claim guard.
 *
 * `forSession()` keeps every claim whose `predicate` is absent, so a
 * predicate-less `content-view` claim permanently replaces `ChatView` for EVERY
 * session — the dashboard becomes unusable, with no chrome to dismiss it.
 * CostView is a global report; its entry point is the `cost` command-route.
 *
 * See change: drop-cost-content-view-claim.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
)["pi-dashboard-plugin"] as { claims: { slot: string; command?: string; predicate?: string }[] };

describe("cost-estimator manifest claims", () => {
  it("declares no content-view claim without a predicate", () => {
    const hijackers = manifest.claims.filter(c => c.slot === "content-view" && !c.predicate);
    expect(hijackers).toEqual([]);
  });

  it("keeps the `cost` command-route as the CostView entry point", () => {
    expect(manifest.claims).toContainEqual(
      expect.objectContaining({ slot: "command-route", command: "cost" }),
    );
  });
});
