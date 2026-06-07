import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  attachmentDirForSession,
  extensionForMime,
  hashBytes,
  persistAttachment,
  cleanupAttachmentsForSession,
  MAX_PER_IMAGE_BYTES,
} from "../ask-user-attachments.js";

// Each test runs under a throwaway HOME so writes never touch the real ~/.pi.
let tmpHome: string;
let origHome: string | undefined;

beforeEach(() => {
  origHome = process.env.HOME;
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-attach-test-"));
  process.env.HOME = tmpHome;
});

afterEach(() => {
  process.env.HOME = origHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

const b64 = (s: string) => Buffer.from(s).toString("base64");

describe("ask-user-attachments", () => {
  it("maps MIME to extension via the allowlist", () => {
    expect(extensionForMime("image/png")).toBe(".png");
    expect(extensionForMime("image/jpeg")).toBe(".jpg");
    expect(extensionForMime("image/gif")).toBe(".gif");
    expect(extensionForMime("image/webp")).toBe(".webp");
    expect(extensionForMime("application/pdf")).toBeNull();
  });

  it("hashBytes is deterministic and 16 hex chars", () => {
    const h1 = hashBytes(Buffer.from("hello"));
    const h2 = hashBytes(Buffer.from("hello"));
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
  });

  it("persists an image and lazily creates the per-session dir", () => {
    const sessionId = "sess-1";
    const dir = attachmentDirForSession(sessionId);
    expect(fs.existsSync(dir)).toBe(false);

    const res = persistAttachment({
      sessionId,
      image: { type: "image", data: b64("PNGDATA"), mimeType: "image/png" },
    });

    expect(res).not.toBeNull();
    expect(res!.path.endsWith(".png")).toBe(true);
    expect(res!.mimeType).toBe("image/png");
    expect(res!.bytes).toBe(Buffer.from("PNGDATA").length);
    expect(fs.existsSync(res!.path)).toBe(true);
    expect(fs.existsSync(dir)).toBe(true);
  });

  it("dedups by hash — same bytes write once", () => {
    const sessionId = "sess-2";
    const image = { type: "image" as const, data: b64("SAME"), mimeType: "image/png" };
    const a = persistAttachment({ sessionId, image })!;
    const mtimeA = fs.statSync(a.path).mtimeMs;
    const b = persistAttachment({ sessionId, image })!;
    expect(b.path).toBe(a.path);
    // No rewrite — mtime unchanged.
    expect(fs.statSync(b.path).mtimeMs).toBe(mtimeA);
  });

  it("drops unsupported MIME types", () => {
    const res = persistAttachment({
      sessionId: "sess-3",
      image: { type: "image", data: b64("X"), mimeType: "application/pdf" },
    });
    expect(res).toBeNull();
  });

  it("drops images over the per-image cap", () => {
    const big = Buffer.alloc(MAX_PER_IMAGE_BYTES + 1).toString("base64");
    const res = persistAttachment({
      sessionId: "sess-4",
      image: { type: "image", data: big, mimeType: "image/png" },
    });
    expect(res).toBeNull();
  });

  it("cleanup removes the session directory and tolerates a missing one", () => {
    const sessionId = "sess-5";
    persistAttachment({
      sessionId,
      image: { type: "image", data: b64("Y"), mimeType: "image/png" },
    });
    const dir = attachmentDirForSession(sessionId);
    expect(fs.existsSync(dir)).toBe(true);
    cleanupAttachmentsForSession(sessionId);
    expect(fs.existsSync(dir)).toBe(false);
    // Second call is a no-op (no throw).
    expect(() => cleanupAttachmentsForSession(sessionId)).not.toThrow();
  });
});
