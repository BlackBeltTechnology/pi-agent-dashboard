/**
 * The digest request opts out of the grant prompt and the installed global
 * wrapper never overrides that. See change: gate-changed-on-disk-by-content (#X8).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearGrantChannel,
  fetchWithoutGrantPrompt,
  GRANT_CHANNEL_HEADER,
  installGrantChannelFetch,
  setGrantChannel,
} from "../grant-channel.js";

const seen: Array<string | null> = [];

beforeAll(() => {
  window.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Headers(init?.headers).get(GRANT_CHANNEL_HEADER));
    return Promise.resolve(new Response("{}"));
  }) as typeof fetch;
  installGrantChannelFetch();
});

beforeEach(() => {
  seen.length = 0;
  clearGrantChannel();
});

describe("fetchWithoutGrantPrompt through the installed wrapper", () => {
  it("sends X-Pi-Grant-Channel: '' on /api/file/digest even with a live capability", async () => {
    setGrantChannel("cap-1");
    await fetchWithoutGrantPrompt("/api/file/digest?cwd=%2Fp&path=foo.ts");
    expect(seen).toEqual([""]);
  });
});
