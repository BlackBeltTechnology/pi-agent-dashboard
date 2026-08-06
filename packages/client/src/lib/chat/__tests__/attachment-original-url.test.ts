import { describe, expect, it } from "vitest";
import { attachmentOriginalUrl } from "../attachment-original-url.js";

const ID = "a".repeat(64);

describe("attachmentOriginalUrl", () => {
  it("builds the session-scoped originals path", () => {
    expect(attachmentOriginalUrl("s1", ID)).toBe(`/api/sessions/s1/attachments/${ID}`);
  });

  it("percent-encodes the session id so it cannot escape its path segment", () => {
    expect(attachmentOriginalUrl("a/../b", ID)).toBe(
      `/api/sessions/a%2F..%2Fb/attachments/${ID}`,
    );
  });

  it("returns null without a session id or attachment id", () => {
    expect(attachmentOriginalUrl(undefined, ID)).toBeNull();
    expect(attachmentOriginalUrl("s1", undefined)).toBeNull();
    expect(attachmentOriginalUrl("", ID)).toBeNull();
  });

  it("returns null for a malformed attachment id rather than requesting it", () => {
    // The server rejects these anyway; not issuing the request keeps the zoom
    // path from flashing a doomed fetch.
    // `${"a".repeat(64)}\n` is included deliberately: in Python/PCRE `$` also
    // matches BEFORE a final newline, which would let a trailing terminator
    // through. JavaScript `$` without the `m` flag matches only at end of
    // input, so this is already rejected — pinned so a future rewrite (or a
    // ported regex) cannot silently relax it.
    for (const bad of ["../etc", "A".repeat(64), "a".repeat(63), "nothex", `${"a".repeat(64)}\n`]) {
      expect(attachmentOriginalUrl("s1", bad), bad).toBeNull();
    }
  });
});
