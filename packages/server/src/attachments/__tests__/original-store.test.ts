import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isFittableImageMime } from "../image-mime.js";
import {
  ALLOWED_IMAGE_MIME,
  findOriginalInTranscript,
  isAllowedImageMime,
  isValidAttachmentId,
} from "../original-store.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "orig-store-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Write a session JSONL whose user message carries `images`. */
function writeTranscript(
  name: string,
  images: Array<{ data: string; mimeType: string }>,
): string {
  const file = join(dir, name);
  const lines = [
    JSON.stringify({ type: "meta", id: "e0" }),
    JSON.stringify({
      type: "message",
      message: {
        role: "user",
        content: [
          { type: "text", text: "hello" },
          ...images.map((i) => ({ type: "image", ...i })),
        ],
      },
    }),
    JSON.stringify({ type: "message", message: { role: "assistant", content: "ok" } }),
  ];
  writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

describe("original-store — attachment id validation (X3 path safety)", () => {
  it("accepts a bare 64-char lowercase hex digest", () => {
    expect(isValidAttachmentId("a".repeat(64))).toBe(true);
    expect(isValidAttachmentId(sha("x"))).toBe(true);
  });

  it("X3: rejects traversal, separators, and non-hex", () => {
    for (const bad of [
      "../../etc/passwd",
      "..",
      "a/".repeat(32),
      `${"a".repeat(63)}/`,
      `${"a".repeat(64)}/../x`,
      "A".repeat(64), // uppercase — normalise-or-reject, we reject
      "g".repeat(64), // non-hex letter
      "a".repeat(63), // too short
      "a".repeat(65), // too long
      "",
      "a".repeat(64) + "\u0000",
      "%2e%2e%2fetc",
    ]) {
      expect(isValidAttachmentId(bad), `should reject ${JSON.stringify(bad)}`).toBe(false);
    }
  });
});

describe("original-store — content-type allow-list (E14/E15)", () => {
  it("E14: allows exactly the supported image types", () => {
    for (const m of ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]) {
      expect(isAllowedImageMime(m)).toBe(true);
    }
    expect([...ALLOWED_IMAGE_MIME].every((m) => m.startsWith("image/"))).toBe(true);
  });

  it("every fittable mime is also servable, so a fitted image can always zoom", () => {
    // The gates diverged on `image/jpg`: admitted + fitted by ingest, refused
    // by the originals endpoint, so the thumbnail rendered and the zoom 404'd.
    for (const m of ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]) {
      expect(isFittableImageMime(m), `fittable ${m} must be servable`).toBe(true);
      expect(isAllowedImageMime(m)).toBe(true);
    }
    // The reverse does NOT have to hold, and the serving gate stays stricter.
    expect(isFittableImageMime("image/svg+xml")).toBe(false);
    expect(isAllowedImageMime("image/svg+xml")).toBe(false);
  });

  it("E15: refuses active-content and non-image types", () => {
    for (const m of [
      "text/html",
      "image/svg+xml", // scriptable — deliberately NOT allow-listed
      "application/javascript",
      "text/plain",
      "application/octet-stream",
      "",
    ]) {
      expect(isAllowedImageMime(m), `should refuse ${m}`).toBe(false);
    }
  });
});

describe("original-store — transcript-backed recovery", () => {
  it("X4: finds the original by content hash and returns its bytes + mime", async () => {
    const data = Buffer.from("PNGDATA-original").toString("base64");
    const file = writeTranscript("s.jsonl", [{ data, mimeType: "image/png" }]);

    const found = await findOriginalInTranscript(file, sha(data));
    expect(found).not.toBeNull();
    expect(found!.mimeType).toBe("image/png");
    // Byte-identical to what was attached.
    expect(found!.bytes.toString("base64")).toBe(data);
  });

  it("X2: a hash that is not in THIS transcript is not found (cross-session refusal)", async () => {
    const file = writeTranscript("a.jsonl", [
      { data: Buffer.from("mine").toString("base64"), mimeType: "image/png" },
    ]);
    // A perfectly valid digest — but of another session's bytes.
    const foreign = sha(Buffer.from("theirs").toString("base64"));
    expect(await findOriginalInTranscript(file, foreign)).toBeNull();
  });

  it("X6: a missing transcript resolves null rather than throwing", async () => {
    const missing = join(dir, "nope.jsonl");
    await expect(findOriginalInTranscript(missing, sha("x"))).resolves.toBeNull();
  });

  it("tolerates malformed lines and keeps scanning", async () => {
    const data = Buffer.from("later-image").toString("base64");
    const file = join(dir, "messy.jsonl");
    writeFileSync(
      file,
      [
        "{not json at all",
        "",
        JSON.stringify({
          type: "message",
          message: { role: "user", content: [{ type: "image", data, mimeType: "image/webp" }] },
        }),
      ].join("\n") + "\n",
    );
    const found = await findOriginalInTranscript(file, sha(data));
    expect(found).not.toBeNull();
    expect(found!.mimeType).toBe("image/webp");
  });

  it("finds an image nested deeper than the top-level content array", async () => {
    const data = Buffer.from("nested").toString("base64");
    const file = join(dir, "nested.jsonl");
    writeFileSync(
      file,
      JSON.stringify({
        type: "message",
        message: {
          role: "user",
          content: [{ type: "toolResult", details: { blocks: [{ type: "image", data, mimeType: "image/jpeg" }] } }],
        },
      }) + "\n",
    );
    const found = await findOriginalInTranscript(file, sha(data));
    expect(found?.mimeType).toBe("image/jpeg");
  });

  it("returns null for a disallowed mime even when the hash matches", async () => {
    // A blob claiming text/html must never be recoverable as servable content.
    const data = Buffer.from("<script>alert(1)</script>").toString("base64");
    const file = writeTranscript("evil.jsonl", [{ data, mimeType: "text/html" }]);
    expect(await findOriginalInTranscript(file, sha(data))).toBeNull();
  });
});
