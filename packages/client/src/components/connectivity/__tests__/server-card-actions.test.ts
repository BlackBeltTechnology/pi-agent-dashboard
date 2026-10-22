/**
 * Review B2 (change: group-servers-by-identity): removing one route must name its scheme,
 * otherwise the server's no-scheme wildcard also deletes the sibling route at the same host:port.
 */
import type { Route } from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const removeKnownServer = vi.fn(async () => undefined);
vi.mock("../../../lib/api/known-servers-api.js", () => ({
  acceptKnownServerMove: vi.fn(),
  addKnownServer: vi.fn(),
  removeKnownServer: (...a: unknown[]) => removeKnownServer(...(a as [])),
}));

import { createServerCardActions } from "../server-card-actions.js";

const route = (scheme: "http" | "https"): Route & { key: string } => ({
  host: "lab.example.org",
  port: 443,
  scheme,
  source: "saved",
  key: `${scheme}://lab.example.org:443`,
});

describe("server card actions — route removal names the scheme", () => {
  beforeEach(() => removeKnownServer.mockClear());

  it("removeRoute sends the scheme for an http route as well as an https route", async () => {
    const actions = createServerCardActions(new Map(), async () => undefined);
    await actions.removeRoute(route("http") as never);
    await actions.removeRoute(route("https") as never);
    expect(removeKnownServer.mock.calls).toEqual([
      ["lab.example.org", 443, "http"],
      ["lab.example.org", 443, "https"],
    ]);
  });

  it("removeServer removes each stored route under its own scheme", async () => {
    const stored = new Map([
      ["http://lab.example.org:443", "saved" as const],
      ["https://lab.example.org:443", "saved" as const],
    ]);
    const actions = createServerCardActions(stored, async () => undefined);
    await actions.removeServer({ routes: [route("http"), route("https")] } as never);
    expect(removeKnownServer.mock.calls).toEqual([
      ["lab.example.org", 443, "http"],
      ["lab.example.org", 443, "https"],
    ]);
  });
});
