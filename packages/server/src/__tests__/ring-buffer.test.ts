import { describe, it, expect } from "vitest";
import { RingBuffer } from "../terminal/terminal-manager.js";

describe("RingBuffer", () => {
  it("stores and returns written data", () => {
    const buf = new RingBuffer(64);
    buf.write(Buffer.from("hello"));
    expect(buf.contents().toString()).toBe("hello");
  });

  it("appends multiple writes", () => {
    const buf = new RingBuffer(64);
    buf.write(Buffer.from("hello "));
    buf.write(Buffer.from("world"));
    expect(buf.contents().toString()).toBe("hello world");
  });

  it("returns empty buffer when nothing written", () => {
    const buf = new RingBuffer(64);
    expect(buf.contents().length).toBe(0);
  });

  it("overwrites oldest data when capacity exceeded", () => {
    const buf = new RingBuffer(8);
    buf.write(Buffer.from("12345678")); // fills exactly
    buf.write(Buffer.from("AB")); // overwrites first 2
    expect(buf.contents().toString()).toBe("345678AB");
  });

  it("handles write larger than capacity", () => {
    const buf = new RingBuffer(4);
    buf.write(Buffer.from("ABCDEFGH"));
    // Only last 4 bytes should remain
    expect(buf.contents().toString()).toBe("EFGH");
  });

  it("handles many small writes wrapping around", () => {
    const buf = new RingBuffer(6);
    buf.write(Buffer.from("AAA"));
    buf.write(Buffer.from("BBB"));
    buf.write(Buffer.from("CC"));
    // Should have BBBCC... last 6 = "BBBCC" wait: AAA + BBB = 6 bytes exactly, then CC overwrites first 2
    expect(buf.contents().toString()).toBe("ABBBCC");
  });
});
