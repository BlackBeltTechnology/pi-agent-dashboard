/**
 * Protocol-version resolution for the dual-era endpoint.
 *
 * Covers test-plan E1 (decision table over method × header × `_meta`), X11
 * (modern strictness regression guard: E13/E14 keep refusing; E15 rewritten
 * so `_meta`-without-header is MissingHeader), and the legacy-era rules of
 * design D1 (initialize negotiation, no-marker default, AmbiguousHeader).
 */
import { describe, expect, it } from "vitest";
import {
  META_VERSION_KEY,
  MODERN_PROTOCOL_VERSION,
  resolveProtocolVersion,
  SUPPORTED_PROTOCOL_VERSIONS,
  LEGACY_PROTOCOL_VERSIONS,
} from "../protocol.js";

const meta = (version: unknown) => ({ _meta: { [META_VERSION_KEY]: version } });
const progressMeta = { _meta: { progressToken: "t1" } };
const INIT = "initialize";

describe("SUPPORTED_PROTOCOL_VERSIONS", () => {
  it("serves the union of both eras, in negotiation order", () => {
    expect(SUPPORTED_PROTOCOL_VERSIONS).toEqual([
      "2025-03-26",
      "2025-06-18",
      "2025-11-25",
      "2026-07-28",
    ]);
    expect(LEGACY_PROTOCOL_VERSIONS).toEqual(["2025-03-26", "2025-06-18", "2025-11-25"]);
    expect(MODERN_PROTOCOL_VERSION).toBe("2026-07-28");
  });
});

describe("E1 — decision table over method × header × _meta", () => {
  type Cell = {
    label: string;
    method: string;
    header: string | string[] | undefined;
    params: unknown;
    want:
      | { ok: true; era: "legacy" | "modern"; version: string }
      | { ok: false; code: string };
  };

  const cells: Cell[] = [
    // Rule 4 — no version marker at all → legacy 2025-03-26.
    { label: "no marker, tools/list", method: "tools/list", header: undefined, params: {}, want: { ok: true, era: "legacy", version: "2025-03-26" } },
    { label: "no marker, listen", method: "subscriptions/listen", header: undefined, params: undefined, want: { ok: true, era: "legacy", version: "2025-03-26" } },
    { label: "progressToken-only _meta", method: "tools/list", header: undefined, params: progressMeta, want: { ok: true, era: "legacy", version: "2025-03-26" } },

    // Rule 3 — body declares a version but no header → MissingHeader.
    { label: "_meta modern, no header (X11 E15 rewrite)", method: "tools/list", header: undefined, params: meta("2026-07-28"), want: { ok: false, code: "MissingHeader" } },
    { label: "_meta legacy, no header", method: "tools/list", header: undefined, params: meta("2025-06-18"), want: { ok: false, code: "MissingHeader" } },

    // Rule 0 — repeated header refused for every method.
    { label: "repeated header, tools/list", method: "tools/list", header: ["2025-06-18", "2026-07-28"], params: {}, want: { ok: false, code: "AmbiguousHeader" } },
    { label: "repeated header, initialize", method: INIT, header: ["2025-06-18", "2025-11-25"], params: { protocolVersion: "2025-06-18" }, want: { ok: false, code: "AmbiguousHeader" } },

    // Rule 2 — header decides; legacy resolves on the header alone.
    { label: "header 2025-03-26, no _meta", method: "tools/list", header: "2025-03-26", params: {}, want: { ok: true, era: "legacy", version: "2025-03-26" } },
    { label: "header 2025-06-18, progressToken _meta", method: "subscriptions/listen", header: "2025-06-18", params: progressMeta, want: { ok: true, era: "legacy", version: "2025-06-18" } },
    { label: "header 2025-11-25, agreeing _meta", method: "tools/list", header: "2025-11-25", params: meta("2025-11-25"), want: { ok: true, era: "legacy", version: "2025-11-25" } },
    { label: "header 2026-07-28, agreeing _meta (modern boundary)", method: "tools/list", header: "2026-07-28", params: meta("2026-07-28"), want: { ok: true, era: "modern", version: "2026-07-28" } },
    { label: "header 2026-07-28, no _meta (E13 strictness kept)", method: "tools/list", header: "2026-07-28", params: {}, want: { ok: false, code: "MissingMeta" } },
    { label: "header 2026-07-28, progressToken-only _meta", method: "tools/list", header: "2026-07-28", params: progressMeta, want: { ok: false, code: "MissingMeta" } },
    { label: "header 2026-07-28, _meta 2025-06-18", method: "tools/list", header: "2026-07-28", params: meta("2025-06-18"), want: { ok: false, code: "HeaderMismatch" } },
    { label: "header 2025-06-18, _meta 2026-07-28", method: "tools/list", header: "2025-06-18", params: meta("2026-07-28"), want: { ok: false, code: "HeaderMismatch" } },
    { label: "unknown header 1999-01-01", method: "tools/list", header: "1999-01-01", params: {}, want: { ok: false, code: "UnsupportedProtocolVersion" } },
    { label: "unknown header 1999-01-01 with agreeing _meta", method: "tools/list", header: "1999-01-01", params: meta("1999-01-01"), want: { ok: false, code: "UnsupportedProtocolVersion" } },

    // Rule 1 — initialize negotiates from params.protocolVersion only.
    { label: "initialize 2025-03-26, no header", method: INIT, header: undefined, params: { protocolVersion: "2025-03-26" }, want: { ok: true, era: "legacy", version: "2025-03-26" } },
    { label: "initialize 2025-06-18, no header", method: INIT, header: undefined, params: { protocolVersion: "2025-06-18" }, want: { ok: true, era: "legacy", version: "2025-06-18" } },
    { label: "initialize 2025-11-25, no header", method: INIT, header: undefined, params: { protocolVersion: "2025-11-25" }, want: { ok: true, era: "legacy", version: "2025-11-25" } },
    { label: "initialize 2026-07-28 resolves modern (handshake refused downstream)", method: INIT, header: undefined, params: { protocolVersion: "2026-07-28" }, want: { ok: true, era: "modern", version: "2026-07-28" } },
    { label: "initialize 2027-01-01 negotiates down to 2025-11-25", method: INIT, header: undefined, params: { protocolVersion: "2027-01-01" }, want: { ok: true, era: "legacy", version: "2025-11-25" } },
    { label: "initialize without protocolVersion", method: INIT, header: undefined, params: {}, want: { ok: false, code: "UnsupportedProtocolVersion" } },
    { label: "initialize with a non-string protocolVersion", method: INIT, header: undefined, params: { protocolVersion: 42 }, want: { ok: false, code: "UnsupportedProtocolVersion" } },
    { label: "initialize params absent entirely", method: INIT, header: undefined, params: undefined, want: { ok: false, code: "UnsupportedProtocolVersion" } },
    { label: "initialize ignores the header (2025 spec sends neither)", method: INIT, header: "2026-07-28", params: { protocolVersion: "2025-06-18" }, want: { ok: true, era: "legacy", version: "2025-06-18" } },
    { label: "initialize ignores a version-bearing _meta", method: INIT, header: undefined, params: { _meta: { [META_VERSION_KEY]: "2026-07-28" }, protocolVersion: "2025-11-25" }, want: { ok: true, era: "legacy", version: "2025-11-25" } },
  ];

  it.each(cells.map((c) => [c.label, c]))(
    "%s",
    (_label, cell) => {
      let result: unknown;
      expect(() => {
        result = resolveProtocolVersion(cell.method, cell.header, cell.params);
      }).not.toThrow();
      expect(result).toEqual(cell.want);
    },
  );
});

describe("X11 — modern strictness regression guard", () => {
  it("E13 — a modern header still requires the _meta version key", () => {
    expect(resolveProtocolVersion("tools/list", "2026-07-28", {})).toEqual({ ok: false, code: "MissingMeta" });
    expect(resolveProtocolVersion("tools/list", "2026-07-28", undefined)).toEqual({ ok: false, code: "MissingMeta" });
    expect(resolveProtocolVersion("tools/list", "2026-07-28", { _meta: {} })).toEqual({ ok: false, code: "MissingMeta" });
  });

  it("E14 — a header/body disagreement is still named precisely", () => {
    expect(resolveProtocolVersion("tools/list", "2025-11-25", meta("2026-07-28"))).toEqual({
      ok: false,
      code: "HeaderMismatch",
    });
    // A mismatch is reported even when BOTH values are individually
    // supported-looking.
    expect(resolveProtocolVersion("tools/list", "2026-07-28 ", meta("2026-07-28"))).toEqual({
      ok: false,
      code: "HeaderMismatch",
    });
    // An empty-string body version is a mismatch against a real header.
    expect(resolveProtocolVersion("tools/list", "2026-07-28", meta(""))).toEqual({
      ok: false,
      code: "HeaderMismatch",
    });
  });

  it("E15 (rewritten) — a _meta declaring 2026-07-28 without a header is MissingHeader", () => {
    expect(resolveProtocolVersion("tools/list", undefined, meta("2026-07-28"))).toEqual({
      ok: false,
      code: "MissingHeader",
    });
    expect(resolveProtocolVersion("tools/list", "", meta("2026-07-28"))).toEqual({
      ok: false,
      code: "MissingHeader",
    });
  });

  it("E12 — a non-string body version is malformed, not a header mismatch", () => {
    expect(() => {
      resolveProtocolVersion("tools/list", "2026-07-28", meta(20260728));
    }).not.toThrow();
    expect(resolveProtocolVersion("tools/list", "2026-07-28", meta(null))).toEqual({
      ok: false,
      code: "UnsupportedProtocolVersion",
    });
    expect(resolveProtocolVersion("tools/list", "2026-07-28", meta({ version: "2026-07-28" }))).toEqual({
      ok: false,
      code: "UnsupportedProtocolVersion",
    });
    expect(resolveProtocolVersion("tools/list", "2026-07-28", meta(["2026-07-28"]))).toEqual({
      ok: false,
      code: "UnsupportedProtocolVersion",
    });
  });

  it("checks the header before the body, so a missing header outranks a bad version", () => {
    expect(resolveProtocolVersion("tools/list", undefined, meta("banana"))).toEqual({
      ok: false,
      code: "MissingHeader",
    });
  });
});
