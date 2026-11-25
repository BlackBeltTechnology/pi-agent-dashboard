/**
 * Composition (task 4.2 and the wiring of 5.4 / 6.1): `registerPlugin` registers
 * `canViewTeam` with core's process-wide `setRouteVisibility`, mounts the routes
 * with the owner rule, starts the UI bridge, refuses to start if the rule cannot
 * be registered, and survives a plugin re-enable (second registration after the
 * registry sealed) with the rule still enforced.
 * See change: add-agent-teams-ui.
 */
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeUiHost } from "../../__tests__/harness/fake-ui-host.js";
import { createFakeRuntimeHost } from "../../__tests__/harness/index.js";
import { canViewTeam, ownerKeyOf } from "../access.js";
import { extensionPoints } from "../extension-points.js";
import { registerPlugin } from "../index.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const c of cleanups.splice(0)) await c();
});

const ALICE = { iss: "idp", sub: "alice" };

function build() {
  const fake = createFakeRuntimeHost();
  const ui = createFakeUiHost();
  const app = Fastify();
  const principal = (req: unknown) => {
    const header = (req as { headers: Record<string, string> }).headers["x-principal"];
    if (!header) return null;
    const [iss, sub] = header.split("|");
    return { iss: iss as string, sub: sub as string };
  };
  const ctx = { ...fake.host, fastify: app, broadcastToSubscribers: ui.host.broadcastToSubscribers, assignSessionRef: ui.host.assignSessionRef, identity: { isEnforced: () => true, principalOf: principal } };
  cleanups.push(
    () => fake.runShutdownHooks(),
    () => app.close(),
  );
  return { fake, ui, app, ctx };
}

async function boot() {
  const b = build();
  await registerPlugin(b.ctx as never);
  await b.app.ready();
  return b;
}

const get = (app: ReturnType<typeof build>["app"], url: string, principal?: string) => app.inject({ method: "GET", url: `/api/plugins/agent-teams${url}`, headers: principal ? { "x-principal": principal } : {} });

describe("registerPlugin", () => {
  it("refuses to start when the visibility rule cannot be registered (an unregistered hook would show every team)", async () => {
    expect(extensionPoints.routeVisibility).toBeUndefined(); // fresh process-wide registry in this file
    vi.spyOn(extensionPoints, "setRouteVisibility").mockImplementation(() => {
      throw new Error("sealed");
    });
    await expect(registerPlugin(build().ctx as never)).rejects.toThrow(/refusing to serve teams unfiltered/);
  });

  it("registers the owner rule before the first request and enforces it on the mounted routes; the bridge is live", async () => {
    const { fake, ui, app } = await boot();
    expect(extensionPoints.routeVisibility).toBe(canViewTeam);
    fake.addSession("S-lead", { cwd: "/work", principalOwner: ownerKeyOf(ALICE) });
    const created = await fake.call("S-lead", "TeamCreate", { name: "alpha" });
    const id = created.data.teamId as string;
    expect(extensionPoints.sealed).toBe(true);

    const mine = await get(app, `/teams/${id}`, "idp|alice");
    expect(mine.statusCode).toBe(200);
    expect(mine.json()).toMatchObject({ id, viewerCanControl: true, epoch: expect.stringMatching(/^[0-9a-f]{16}$/) });
    expect((await get(app, `/teams/${id}`, "idp|bob")).statusCode).toBe(404);
    expect((await get(app, "/teams", "idp|bob")).json().teams).toEqual([]);
    expect((await get(app, `/teams/${id}`, "urn:pi-dashboard:local-operator|op")).statusCode).toBe(200);
    expect((await get(app, `/teams/${id}`)).statusCode).toBe(404); // enforced and no principal

    expect(ui.frames.at(-1)).toMatchObject({ type: "plugin_event", sessionId: "S-lead", event: { data: { teamId: id } } });
    expect(ui.stampOf("S-lead")).toEqual({ teamId: id });
  });

  it("a second registration after the registry sealed (plugin re-enable) does not throw and the rule is still enforced", async () => {
    const again = await boot();
    again.fake.addSession("S-lead", { cwd: "/work", principalOwner: ownerKeyOf(ALICE) });
    const id = (await again.fake.call("S-lead", "TeamCreate", { name: "beta" })).data.teamId as string;
    expect((await get(again.app, `/teams/${id}`, "idp|alice")).statusCode).toBe(200);
    expect((await get(again.app, `/teams/${id}`, "idp|bob")).statusCode).toBe(404);
  });
});
