/**
 * Behaviour of the bridge-owned follow-up buffer: entry shape, the two
 * independent bounds (queue depth + aggregate bytes), and the mutation
 * semantics the four bridge handlers delegate to.
 *
 * Exercises the REAL module (`followup-buffer.ts`), not a mirror: every case
 * below fails if the production admission arithmetic regresses. The ceiling is
 * INJECTED at 1 KiB per design D3b so boundary cases drive the real comparison
 * without allocating tens of megabytes of base64.
 *
 * Covers test-plan rows E1/E2 (entry + view shape), E5–E12, E13, E15, E16, E17,
 * E19, E22, E25.
 *
 * See change: fix-bridge-followup-image-drop.
 */
import { describe, expect, it } from "vitest";
import {
  createFollowupBuffer,
  entryBytes,
  FOLLOWUP_BUFFER_MAX_BYTES,
  FOLLOWUP_QUEUE_CAP,
} from "../followup-buffer.js";

const KIB = 1024;

/** Flat pi-shape image whose base64 payload is exactly `bytes` long. */
const png = (bytes: number) => ({
  type: "image" as const,
  data: "A".repeat(bytes),
  mimeType: "image/png",
});

/** Nested Anthropic-shape image — sizes at ZERO under a direct `.data` read. */
const nestedPng = (bytes: number) => ({
  type: "image",
  source: { type: "base64", media_type: "image/png", data: "A".repeat(bytes) },
});

/** Buffer with a 1 KiB ceiling, pre-filled to `bytes` via one text entry. */
function bufferAt(bytes: number, maxBytes = KIB) {
  const buffer = createFollowupBuffer({ maxBytes });
  if (bytes > 0) expect(buffer.push({ text: "x".repeat(bytes) })).toEqual({ ok: true });
  expect(buffer.totalBytes()).toBe(bytes);
  return buffer;
}

describe("followup buffer — entry + wire projection", () => {
  it("buffers an image-bearing entry and reports its image COUNT on the wire (E1)", () => {
    const buffer = createFollowupBuffer();
    buffer.push({ text: "describe", images: [png(4), png(6)] });

    expect(buffer.entries()).toEqual([
      { text: "describe", images: [png(4), png(6)] },
    ]);
    expect(buffer.views()).toEqual([{ text: "describe", imageCount: 2 }]);
  });

  it("never puts image BYTES on the wire projection (D2)", () => {
    const buffer = createFollowupBuffer();
    buffer.push({ text: "describe", images: [png(64)] });

    expect(JSON.stringify(buffer.views())).not.toContain("AAAA");
  });

  it("reports zero images for a text-only entry (E2)", () => {
    const buffer = createFollowupBuffer();
    buffer.push({ text: "plain" });

    expect(buffer.entries()).toEqual([{ text: "plain" }]);
    expect(buffer.views()).toEqual([{ text: "plain", imageCount: 0 }]);
  });
});

describe("followup buffer — byte sizing", () => {
  it("sums UTF-8 text bytes plus raw base64 image bytes (E12)", () => {
    const text = "héllo wörld"; // 13 UTF-8 bytes, 11 UTF-16 code units
    expect(entryBytes({ text, images: [png(100)] })).toBe(
      Buffer.byteLength(text, "utf8") + 100,
    );
  });

  it("does NOT under-count multi-byte text the way String.length would", () => {
    const text = "héllo wörld";
    expect(entryBytes({ text })).toBeGreaterThan(text.length);
  });

  it("sizes a NESTED-shape image by its real bytes, not zero (E25)", () => {
    expect(entryBytes({ text: "", images: [nestedPng(4 * KIB) as never] })).toBe(4 * KIB);
  });
});

describe("followup buffer — byte ceiling (BVA)", () => {
  it("admits an entry landing just below the ceiling (E5)", () => {
    const buffer = bufferAt(900);
    expect(buffer.push({ text: "y".repeat(100) })).toEqual({ ok: true });
    expect(buffer.length).toBe(2);
  });

  it("admits an entry landing EXACTLY on the ceiling (E6)", () => {
    const buffer = bufferAt(900);
    expect(buffer.push({ text: "y".repeat(124) })).toEqual({ ok: true });
    expect(buffer.totalBytes()).toBe(KIB);
  });

  it("refuses an entry landing one byte above the ceiling (E7)", () => {
    const buffer = bufferAt(900);
    const result = buffer.push({ text: "y".repeat(125) });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("bytes");
    expect(result.ok === false && result.message).toMatch(/byte ceiling/i);
    expect(buffer.length).toBe(1);
    expect(buffer.totalBytes()).toBe(900);
  });

  it("refuses an over-ceiling entry WHOLE — never text-only, never image-stripped (E8)", () => {
    const buffer = bufferAt(0);
    const result = buffer.push({ text: "describe", images: [png(4 * KIB)] });

    expect(result.ok).toBe(false);
    expect(buffer.entries()).toEqual([]);
    expect(buffer.totalBytes()).toBe(0);
  });

  it("refuses a nested-shape entry that only LOOKS empty to a direct read (E25)", () => {
    const buffer = bufferAt(0);
    const result = buffer.push({ text: "d", images: [nestedPng(4 * KIB) as never] });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("bytes");
    expect(buffer.entries()).toEqual([]);
  });
});

describe("followup buffer — the two bounds are independent", () => {
  it("refuses on BYTES while the entry count is far below the cap (E9)", () => {
    const buffer = createFollowupBuffer({ maxBytes: KIB });
    for (let i = 0; i < 3; i++) buffer.push({ text: "z".repeat(333) });
    expect(buffer.length).toBe(3);

    const result = buffer.push({ text: "y".repeat(100) });
    expect(result.ok === false && result.reason).toBe("bytes");
  });

  it("refuses on COUNT while the byte total is negligible (E10)", () => {
    const buffer = createFollowupBuffer();
    for (let i = 0; i < FOLLOWUP_QUEUE_CAP; i++) buffer.push({ text: "t" });

    const result = buffer.push({ text: "0123456789" });
    expect(result.ok === false && result.reason).toBe("cap");
    expect(result.ok === false && result.message).toMatch(/queue is full/i);
    expect(buffer.length).toBe(FOLLOWUP_QUEUE_CAP);
  });

  it("keeps the refusal SHAPE identical under an injected ceiling (E11)", () => {
    const injected = createFollowupBuffer({ maxBytes: KIB });
    const injectedRefusal = injected.push({ text: "y".repeat(KIB + 1) });

    const dflt = createFollowupBuffer();
    const defaultRefusal = dflt.push({ text: "y".repeat(FOLLOWUP_BUFFER_MAX_BYTES + 1) });

    expect(injectedRefusal.ok).toBe(false);
    expect(defaultRefusal.ok).toBe(false);
    expect(Object.keys(injectedRefusal)).toEqual(Object.keys(defaultRefusal));
    expect(injectedRefusal.ok === false && injectedRefusal.reason).toBe(
      defaultRefusal.ok === false && defaultRefusal.reason,
    );
  });
});

describe("followup buffer — mutation semantics", () => {
  it("preserves an entry's images across a text edit (E13)", () => {
    const buffer = createFollowupBuffer();
    buffer.push({ text: "describe", images: [png(8)] });

    expect(buffer.editText(0, "describe in detail")).toEqual({ ok: true });
    expect(buffer.entries()).toEqual([{ text: "describe in detail", images: [png(8)] }]);
    expect(buffer.views()).toEqual([{ text: "describe in detail", imageCount: 1 }]);
  });

  it("refuses an edit that would breach the ceiling, leaving the entry untouched (E14)", () => {
    const buffer = createFollowupBuffer({ maxBytes: KIB });
    buffer.push({ text: "p".repeat(995) });
    buffer.push({ text: "short" });

    const result = buffer.editText(1, "q".repeat(200));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("bytes");
    expect(buffer.entries()[1]).toEqual({ text: "short" });
  });

  it("refuses an out-of-range edit index without mutating (E19)", () => {
    const buffer = createFollowupBuffer();
    buffer.push({ text: "a" });

    const result = buffer.editText(5, "x");
    expect(result).toEqual({ ok: false, reason: "range", message: "Index out of range" });
    expect(buffer.entries()).toEqual([{ text: "a" }]);
  });

  it("carries images when an entry is promoted to the head (E15)", () => {
    const buffer = createFollowupBuffer();
    buffer.push({ text: "a" });
    buffer.push({ text: "b", images: [png(8)] });

    expect(buffer.promote(1)).toBe(true);
    expect(buffer.entries()[0]).toEqual({ text: "b", images: [png(8)] });
    expect(buffer.views()).toEqual([
      { text: "b", imageCount: 1 },
      { text: "a", imageCount: 0 },
    ]);
  });

  it("treats promote(0) and an out-of-range promote as no-ops", () => {
    const buffer = createFollowupBuffer();
    buffer.push({ text: "a" });
    buffer.push({ text: "b" });

    expect(buffer.promote(0)).toBe(false);
    expect(buffer.promote(9)).toBe(false);
    expect(buffer.views().map((v) => v.text)).toEqual(["a", "b"]);
  });

  it("releases bytes on removal so a previously refused send is admitted (E16)", () => {
    const buffer = createFollowupBuffer({ maxBytes: KIB });
    buffer.push({ text: "r".repeat(600) });
    buffer.push({ text: "s".repeat(400) });

    const refused = buffer.push({ text: "t".repeat(300) });
    expect(refused.ok).toBe(false);

    expect(buffer.removeAt(1)).toBe(true);
    expect(buffer.push({ text: "t".repeat(300) })).toEqual({ ok: true });
  });

  it("releases image bytes on reset, so admission sees a zero total (E22)", () => {
    const buffer = createFollowupBuffer({ maxBytes: KIB });
    buffer.push({ text: "describe", images: [png(900)] });
    expect(buffer.totalBytes()).toBeGreaterThan(900);

    buffer.reset();

    expect(buffer.entries()).toEqual([]);
    expect(buffer.totalBytes()).toBe(0);
    expect(buffer.push({ text: "u".repeat(900) })).toEqual({ ok: true });
  });

  it("derives the total from live entries after every mutation — no drift (E17)", () => {
    const buffer = createFollowupBuffer({ maxBytes: KIB });
    const sumOfPresent = () =>
      buffer.entries().reduce((total, entry) => total + entryBytes(entry), 0);

    buffer.push({ text: "a".repeat(100) });
    buffer.push({ text: "b".repeat(200), images: [png(50)] });
    expect(buffer.totalBytes()).toBe(sumOfPresent());

    buffer.shift();
    expect(buffer.totalBytes()).toBe(sumOfPresent());

    buffer.push({ text: "c".repeat(120) });
    buffer.removeAt(0);
    expect(buffer.totalBytes()).toBe(sumOfPresent());

    buffer.push({ text: "d".repeat(80) });
    buffer.promote(1);
    expect(buffer.totalBytes()).toBe(sumOfPresent());

    buffer.clearIndices([0]);
    expect(buffer.totalBytes()).toBe(sumOfPresent());

    buffer.clearAll();
    expect(buffer.totalBytes()).toBe(0);

    // A full-size entry is admitted again: nothing leaked across the sequence.
    expect(buffer.push({ text: "e".repeat(KIB) })).toEqual({ ok: true });
  });

  it("finds a drained entry by exact text and splices it (message_start matcher)", () => {
    const buffer = createFollowupBuffer();
    buffer.push({ text: "alpha" });
    buffer.push({ text: "beta", images: [png(4)] });

    expect(buffer.indexOfText("beta")).toBe(1);
    expect(buffer.indexOfText("nope")).toBe(-1);
    buffer.removeAt(1);
    expect(buffer.views().map((v) => v.text)).toEqual(["alpha"]);
  });
});
