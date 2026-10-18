/**
 * `randomUuid()` / `copyText()` — non-secure-context safe helpers.
 * See change: audit-plugin-bundles-non-secure-context (test-plan #E1–#E7).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText, randomUuid } from "../secure-context.js";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const realCrypto = globalThis.crypto;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("randomUuid", () => {
  it("E1: builds distinct v4 UUIDs when randomUUID is missing", () => {
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array<ArrayBuffer>) => realCrypto.getRandomValues(a), randomUUID: undefined });
    const ids = Array.from({ length: 1000 }, () => randomUuid());
    for (const id of ids) expect(id).toMatch(V4);
    expect(new Set(ids).size).toBe(1000);
  });

  it("E2: prefers the native randomUUID", () => {
    const randomUUID = vi.fn(() => "11111111-1111-4111-8111-111111111111");
    const getRandomValues = vi.fn();
    vi.stubGlobal("crypto", { randomUUID, getRandomValues });
    expect(randomUuid()).toBe("11111111-1111-4111-8111-111111111111");
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(getRandomValues).not.toHaveBeenCalled();
  });
});

describe("copyText", () => {
  const stubExec = (impl: () => boolean) => {
    const exec = vi.fn(impl);
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    return exec;
  };
  const noClipboard = () => vi.stubGlobal("navigator", { clipboard: undefined });

  it("E3: uses writeText when available", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const exec = stubExec(() => true);
    await expect(copyText("x")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("x");
    expect(exec).not.toHaveBeenCalled();
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
  });

  it("E4: falls back to execCommand when clipboard is undefined", async () => {
    noClipboard();
    const exec = stubExec(() => true);
    await expect(copyText("x")).resolves.toBe(true);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith("copy");
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
  });

  it("E5: falls back when writeText rejects", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => { throw new DOMException("no", "NotAllowedError"); }) } });
    stubExec(() => true);
    await expect(copyText("x")).resolves.toBe(true);
  });

  it("E6: false when execCommand returns false", async () => {
    noClipboard();
    stubExec(() => false);
    await expect(copyText("x")).resolves.toBe(false);
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
  });

  it("E7: false (no throw) when execCommand throws", async () => {
    noClipboard();
    stubExec(() => {
      throw new Error("boom");
    });
    await expect(copyText("x")).resolves.toBe(false);
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
  });
});
