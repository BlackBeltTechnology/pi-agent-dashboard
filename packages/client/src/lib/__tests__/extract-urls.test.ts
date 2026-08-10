/**
 * Tests for `extractRecentUrls`. See change: render-file-previews.
 */
import { describe, it, expect } from "vitest";
import { extractRecentUrls } from "../preview/extract-urls.js";
import type { ChatMessage } from "../chat/event-reducer.js";

function msg(content: string, id = String(Math.random())): ChatMessage {
  return { id, role: "assistant", content, timestamp: 0 } as ChatMessage;
}

describe("extractRecentUrls", () => {
  it("returns [] when no URLs", () => {
    expect(extractRecentUrls([msg("hello world"), msg("no link here")])).toEqual([]);
  });

  it("scans newest-first and dedupes preserving newest-first order", () => {
    // messages stored oldest-first by convention. Older: c.com, dup a.com.
    // Newer: a.com, b.com (newest).
    const messages: ChatMessage[] = [
      msg("see https://c.com once"),
      msg("see https://a.com again"),
      msg("see https://a.com first"),
      msg("see https://b.com after"),
    ];
    expect(extractRecentUrls(messages)).toEqual([
      "https://b.com",
      "https://a.com",
      "https://c.com",
    ]);
  });

  it("caps at 50 unique URLs", () => {
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 200; i++) messages.push(msg(`https://example.com/${i}`));
    const out = extractRecentUrls(messages);
    expect(out.length).toBe(50);
    // Newest first → the last-pushed URL is first.
    expect(out[0]).toBe("https://example.com/199");
  });

  it("strips trailing punctuation", () => {
    expect(extractRecentUrls([msg("see https://example.com/foo.")])).toEqual([
      "https://example.com/foo",
    ]);
    expect(extractRecentUrls([msg("(https://example.com/x)")])).toEqual([
      "https://example.com/x",
    ]);
    expect(extractRecentUrls([msg("https://example.com/y;")])).toEqual([
      "https://example.com/y",
    ]);
  });

  it("matches http and https", () => {
    expect(
      extractRecentUrls([msg("see http://x.test and https://y.test")]),
    ).toEqual(["http://x.test", "https://y.test"]);
  });

  it("extracts URLs from `result` field of tool messages too", () => {
    const m = { id: "t", role: "toolResult", content: "", result: "fetched https://api.example.com/v1", timestamp: 0 } as ChatMessage;
    expect(extractRecentUrls([m])).toEqual(["https://api.example.com/v1"]);
  });
});
