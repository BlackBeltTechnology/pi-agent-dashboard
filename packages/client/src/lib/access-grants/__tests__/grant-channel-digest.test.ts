/**
 * The digest request opts out of the access-grant dialog even through the
 * installed global fetch wrapper: the wrapper never overrides a header the
 * caller set, so a background verification is never held or prompted.
 * See change: gate-changed-on-disk-by-content (test-plan #X8, D4).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFileDigest } from "../../file-digest.js";
import {
  clearGrantChannel,
  GRANT_CHANNEL_HEADER,
  installGrantChannelFetch,
  setGrantChannel,
} from "../grant-channel.js";

const seen: Array<{ url: string; header: string | null }> = [];

beforeAll(() => {
  window.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    seen.push({ url, header: new Headers(init?.headers).get(GRANT_CHANNEL_HEADER) });
    return Promise.resolve(
      new Response(JSON.stringify({ success: true, data: { sha1: "abc", size: 1, mtime: 2 } }), { status: 200 }),
    );
  }) as typeof fetch;
  installGrantChannelFetch();
});

beforeEach(() => {
  seen.length = 0;
  clearGrantChannel();
});

describe("digest request through the installed grant-channel wrapper", () => {
  it("X8: carries an EMPTY X-Pi-Grant-Channel even while a capability is held", async () => {
    setGrantChannel("cap-1");
    const d = await fetchFileDigest("/proj", "src/a.ts", "verify");
    expect(d).toEqual({ sha1: "abc", size: 1, mtime: 2 });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toContain("/api/file/digest?cwd=%2Fproj&path=src%2Fa.ts&purpose=verify");
    expect(seen[0].header).toBe("");
  });

  it("a plain same-origin /api fetch still carries the capability (control)", async () => {
    setGrantChannel("cap-1");
    await fetch("/api/file?cwd=%2Fproj&path=a.ts");
    expect(seen[0].header).toBe("cap-1");
  });

  it("maps every non-answer to null: 404, malformed body, missing sha1", async () => {
    const original = window.fetch;
    const answer = (res: Response) => {
      window.fetch = vi.fn(() => Promise.resolve(res)) as typeof fetch;
    };
    answer(new Response("{}", { status: 404 }));
    expect(await fetchFileDigest("/p", "a", "baseline")).toBeNull();
    answer(new Response("not json", { status: 200 }));
    expect(await fetchFileDigest("/p", "a", "baseline")).toBeNull();
    answer(new Response(JSON.stringify({ success: true, data: { size: 9, mtime: 1 } }), { status: 200 }));
    expect(await fetchFileDigest("/p", "a", "baseline")).toBeNull();
    window.fetch = original;
  });
});
