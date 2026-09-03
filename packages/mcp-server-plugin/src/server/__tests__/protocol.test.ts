/**
 * Protocol-version negotiation for revision 2026-07-28.
 *
 * Covers test-plan E10 (supported boundary), E11 (just outside), E12
 * (malformed), E13 (absent `params._meta`), E14 (header/body mismatch), E15
 * (absent header), and design.md Decision 10 (no legacy revisions).
 */
import { describe, expect, it } from "vitest";
import {
  CURRENT_PROTOCOL_VERSION,
  META_VERSION_KEY,
  SUPPORTED_PROTOCOL_VERSIONS,
  resolveProtocolVersion,
} from "../protocol.js";

const meta = (version: unknown) => ({ _meta: { [META_VERSION_KEY]: version } });

describe("SUPPORTED_PROTOCOL_VERSIONS", () => {
  it("serves exactly one revision (Decision 10 — no legacy)", () => {
    expect(SUPPORTED_PROTOCOL_VERSIONS).toEqual(["2026-07-28"]);
    expect(CURRENT_PROTOCOL_VERSION).toBe("2026-07-28");
  });
});

describe("resolveProtocolVersion", () => {
  it("E10 — accepts the supported boundary 2026-07-28", () => {
    expect(resolveProtocolVersion("2026-07-28", meta("2026-07-28"))).toEqual({
      ok: true,
      version: "2026-07-28",
    });
  });

  it("E11 — refuses 2025-11-25, the revision just outside", () => {
    const r = resolveProtocolVersion("2025-11-25", meta("2025-11-25"));
    expect(r).toEqual({ ok: false, code: "UnsupportedProtocolVersion" });
  });

  it("Decision 10 — refuses 2025-06-18 rather than falling back to a legacy handshake", () => {
    const r = resolveProtocolVersion("2025-06-18", meta("2025-06-18"));
    expect(r).toEqual({ ok: false, code: "UnsupportedProtocolVersion" });
  });

  it("E12 — refuses a bare-word version that agrees with its header", () => {
    // Header and body agree, so the refusal can only come from the value
    // itself being unsupported — not from a spurious mismatch.
    expect(resolveProtocolVersion("banana", meta("banana"))).toEqual({
      ok: false,
      code: "UnsupportedProtocolVersion",
    });
  });

  it.each([
    ["null", null],
    ["a number", 20260728],
    ["an object", { version: "2026-07-28" }],
    ["an array", ["2026-07-28"]],
  ])("E12 — a non-string version (%s) is malformed, not a header mismatch", (_label, version) => {
    // A non-string can never compare equal to the header string. Reporting
    // HeaderMismatch here would blame the header for a defect entirely in the
    // body, so the type is judged before the comparison.
    let result: unknown;
    expect(() => {
      result = resolveProtocolVersion("2026-07-28", meta(version));
    }).not.toThrow();
    expect(result).toEqual({ ok: false, code: "UnsupportedProtocolVersion" });
  });

  it("E12 — an empty-string body version is a mismatch against a real header", () => {
    expect(resolveProtocolVersion("2026-07-28", meta(""))).toEqual({
      ok: false,
      code: "HeaderMismatch",
    });
  });

  it("E13 — refuses an absent params._meta rather than defaulting to latest", () => {
    expect(resolveProtocolVersion("2026-07-28", {})).toEqual({ ok: false, code: "MissingMeta" });
    expect(resolveProtocolVersion("2026-07-28", undefined)).toEqual({ ok: false, code: "MissingMeta" });
  });

  it("E13 — refuses a _meta that omits the version key", () => {
    expect(resolveProtocolVersion("2026-07-28", { _meta: {} })).toEqual({
      ok: false,
      code: "MissingMeta",
    });
  });

  it("E14 — reports HeaderMismatch when the header disagrees with the body", () => {
    expect(resolveProtocolVersion("2025-11-25", meta("2026-07-28"))).toEqual({
      ok: false,
      code: "HeaderMismatch",
    });
  });

  it("E14 — a mismatch is reported even when BOTH values are individually supported-looking", () => {
    // Guards against an implementation that validates the body and ignores the
    // header entirely: here the body is valid, so only a real comparison fails.
    expect(resolveProtocolVersion("2026-07-28 ", meta("2026-07-28"))).toEqual({
      ok: false,
      code: "HeaderMismatch",
    });
  });

  it("E15 — refuses an absent MCP-Protocol-Version header", () => {
    expect(resolveProtocolVersion(undefined, meta("2026-07-28"))).toEqual({
      ok: false,
      code: "MissingHeader",
    });
  });

  it("E15 — an empty header is absent, not a mismatch", () => {
    expect(resolveProtocolVersion("", meta("2026-07-28"))).toEqual({
      ok: false,
      code: "MissingHeader",
    });
  });

  it("E15 — a repeated header (array) is refused rather than silently taking one", () => {
    expect(resolveProtocolVersion(["2026-07-28", "2025-11-25"], meta("2026-07-28"))).toEqual({
      ok: false,
      code: "MissingHeader",
    });
  });

  it("checks the header before the body, so a missing header outranks a bad version", () => {
    expect(resolveProtocolVersion(undefined, meta("banana"))).toEqual({
      ok: false,
      code: "MissingHeader",
    });
  });
});
