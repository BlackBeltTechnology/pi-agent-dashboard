/**
 * Repo-root `public/sw.js` fetch handler: `/api/*`, `/plugin-assets/*` and `/host/*` are forwarded
 * untouched (the browser performs the default fetch; no `respondWith`, no fabricated 503); other
 * requests keep the "Offline" fallback.
 * See change: fix-openspec-profile-load-race, decouple-plugins-from-core (task 6.19).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const SW_SOURCE = fs.readFileSync(path.resolve(__dirname, "../../../../public/sw.js"), "utf-8");

function loadFetchListener(networkFetch: (req: unknown) => Promise<unknown>) {
  const listeners: Record<string, Array<(e: any) => void>> = {};
  const self = { addEventListener: (t: string, fn: (e: any) => void) => (listeners[t] ??= []).push(fn), location: { origin: "https://dash.example" } };
  new Function("self", "clients", "fetch", "Response", SW_SOURCE)(self, {}, networkFetch, Response);
  return (url: string) => {
    const respondWith = vi.fn();
    for (const fn of listeners.fetch ?? []) fn({ request: { url: `https://dash.example${url}` }, respondWith });
    return respondWith;
  };
}

describe("service worker fetch pass-through (#E80)", () => {
  it.each([
    "/api/plugins",
    `/plugin-assets/ext/${"a".repeat(64)}/index.js`,
    "/host/react.js",
  ])("%s is not intercepted", (url) => {
    const respondWith = loadFetchListener(async () => new Response("x"))(url);
    expect(respondWith).not.toHaveBeenCalled();
  });

  it("other requests are still answered, with the Offline fallback on a network failure", async () => {
    const respondWith = loadFetchListener(async () => {
      throw new TypeError("network down");
    })("/assets/index-abc.js");
    expect(respondWith).toHaveBeenCalledTimes(1);
    const res = (await respondWith.mock.calls[0][0]) as Response;
    expect(res.status).toBe(503);
  });

  it("lookalike prefixes are not passed through", () => {
    const respondWith = loadFetchListener(async () => new Response("x"))("/hostile/a.js");
    expect(respondWith).toHaveBeenCalledTimes(1);
  });
});
