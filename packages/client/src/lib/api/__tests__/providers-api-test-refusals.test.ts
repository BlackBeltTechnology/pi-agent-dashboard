/**
 * `testProvider` hands the server's NET-04 refusals to the pill verbatim — the
 * client never rewrites them. See change: close-local-listener-and-egress-gaps (task 5.6).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { setGlobalApiBase } from "../api-context.js";
import { testProvider } from "../providers-api.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  setGlobalApiBase("");
});

describe("testProvider — server refusals reach the caller verbatim", () => {
  it.each([
    "Re-enter the API key to test a changed Base URL",
    "Environment-variable keys can only be tested with the Base URL saved with them",
    "Base URL is not a valid URL",
    "provider target is a link-local or metadata address",
    "provider target is this dashboard",
  ])("%s", async (error) => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ ok: false, error }), { status: 200, headers: { "content-type": "application/json" } }),
    ) as typeof fetch;
    expect(await testProvider({ baseUrl: "http://x", apiKey: "***", api: "openai-completions" })).toEqual({ ok: false, error });
  });
});
