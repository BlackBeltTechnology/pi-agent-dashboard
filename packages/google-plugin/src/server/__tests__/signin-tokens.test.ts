/**
 * Sign-in keeps tokens on the dashboard (test-plan B14): on every path the server's own outbound HTTP goes to the
 * (fake) Google only — never to the hosted return page — and the grant is stored in the `google` namespace.
 * See change: add-google-connect.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeHarness, OWN_BB, ownClient, TEST_ENDPOINTS } from "../../__tests__/fakes.js";
import { SCOPE } from "../../shared/products.js";
import { clientKey } from "../store.js";

const cal = [SCOPE.calendarReadonly];

afterEach(() => vi.unstubAllGlobals());

const paths: Array<[string, () => ReturnType<typeof makeHarness>, Record<string, unknown>]> = [
  ["local", () => makeHarness({ google: { scope: cal } }), { browser: "local" }],
  ["return", () => makeHarness({ google: { scope: cal } }), { browser: "remote" }],
  ["web", () => makeHarness({ initial: { [clientKey("w")]: ownClient("w", "W", OWN_BB, { type: "web" }) as never }, google: { scope: cal } }), { browser: "remote", client: "own:w" }],
  ["paste", () => makeHarness({ initial: { [clientKey("bb")]: ownClient("bb", "BB") as never }, google: { scope: cal } }), { browser: "remote", client: "own:bb" }],
];

describe("B14 — the token exchange talks to Google only; the grant stays in namespace google", () => {
  it.each(paths)("%s path: every outbound request is to the fake Google, none to pi-dashboard.dev, record stored", async (path, mk, input) => {
    const globalFetch = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", globalFetch);
    const h = mk();
    await h.connect.acceptDisclosure();
    expect(await h.connect.startConnect({ products: { calendar: "read" }, ...input } as never)).toMatchObject({ ok: true, path });
    await h.runFlow();

    const googleHost = new URL(TEST_ENDPOINTS.token).host;
    expect(h.google.urls.length).toBeGreaterThan(0);
    for (const u of h.google.urls) {
      expect(new URL(u).host, u).toBe(googleHost);
      expect(u).not.toContain("pi-dashboard.dev");
    }
    expect(h.google.calls.map((c) => c.grant)).toEqual(["authorization_code"]);
    expect(globalFetch).not.toHaveBeenCalled();

    const keys = await h.creds.list();
    expect(keys).toContain("acct:s1");
    expect(keys.filter((k) => !k.startsWith("acct:") && !k.startsWith("client:") && k !== "disclosure")).toEqual([]);
    expect(await h.store.list()).toHaveLength(1);
    expect(JSON.stringify(await h.creds.get("acct:s1"))).toContain("REFRESH-new");
  });
});
