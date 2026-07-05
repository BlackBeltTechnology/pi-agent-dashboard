/**
 * Doctor core — section assignment, suggestion taxonomy, and the
 * Decision-8 lint (every non-ok check has non-empty
 * message/detail/suggestion). See change: doctor-rich-output.
 */
import { describe, it, expect } from "vitest";
import {
  SECTION_OF,
  SUGGESTIONS,
  stampSectionsAndSuggestions,
  checkAttachedServerVersion,
  type DoctorCheck,
  type DoctorStatus,
} from "../doctor-core.js";

const ALL_CHECK_NAMES = Object.keys(SECTION_OF);

describe("SECTION_OF", () => {
  it("maps every canonical check name to one of the six sections", () => {
    const allowed = new Set([
      "runtime",
      "pi-tooling",
      "server",
      "tunnel",
      "setup",
      "diagnostics",
    ]);
    for (const name of ALL_CHECK_NAMES) {
      expect(allowed.has(SECTION_OF[name])).toBe(true);
    }
  });

  it("covers all six sections (none empty)", () => {
    const sections = new Set(Object.values(SECTION_OF));
    for (const s of [
      "runtime",
      "pi-tooling",
      "server",
      "tunnel",
      "setup",
      "diagnostics",
    ]) {
      expect(sections.has(s as never)).toBe(true);
    }
  });

  it("routes the four tunnel checks to section: 'tunnel'", () => {
    expect(SECTION_OF["zrok binary"]).toBe("tunnel");
    expect(SECTION_OF["zrok environment"]).toBe("tunnel");
    expect(SECTION_OF["zrok API reachable"]).toBe("tunnel");
    expect(SECTION_OF["tunnel runtime"]).toBe("tunnel");
  });
});

describe("SUGGESTIONS", () => {
  it("returns undefined for status=ok across every check name", () => {
    for (const name of ALL_CHECK_NAMES) {
      const fn = SUGGESTIONS[name];
      expect(fn).toBeDefined();
      expect(fn?.("ok")).toBeUndefined();
    }
  });

  it("returns a non-empty string for status=error or warning when defined", () => {
    for (const name of ALL_CHECK_NAMES) {
      const fn = SUGGESTIONS[name];
      // Electron is the only one that returns undefined even for non-ok
      // (because today it never fails). Skip it.
      if (name === "Electron") continue;
      const w = fn?.("warning");
      const e = fn?.("error");
      expect(typeof w === "string" && w.length > 0).toBe(true);
      expect(typeof e === "string" && e.length > 0).toBe(true);
    }
  });

  it("constrains suggestion text to the allowed Markdown subset", () => {
    // Allowed: **bold**, single-backtick code, [text](url). Disallow: tables,
    // headings, fenced blocks, raw HTML.
    for (const name of ALL_CHECK_NAMES) {
      const fn = SUGGESTIONS[name];
      const candidates: (string | undefined)[] = [
        fn?.("warning"),
        fn?.("error"),
        fn?.("error", undefined, "not-found"),
        fn?.("error", undefined, "permission-denied"),
        fn?.("error", undefined, "timeout"),
        fn?.("error", undefined, "non-zero-exit"),
      ];
      for (const s of candidates) {
        if (!s) continue;
        // No fenced code blocks.
        expect(/```/.test(s)).toBe(false);
        // No headings at line start.
        expect(/^#{1,6}\s/m.test(s)).toBe(false);
        // No raw HTML tags (closing, self-closing, or with attributes).
        // Plain `<placeholder>` text is allowed (used as prose).
        expect(/<\/[a-zA-Z]|<[a-zA-Z][^>]*\s+[^>]+>|<[a-zA-Z][^>]*\/>/.test(s)).toBe(false);
        // Triple-asterisk or underline for bold not allowed.
        expect(/\*\*\*|___/.test(s)).toBe(false);
      }
    }
  });
});

describe("stampSectionsAndSuggestions (Decision 8 lint)", () => {
  it("stamps section + suggestion on non-ok rows by name", () => {
    const checks: DoctorCheck[] = [
      { name: "pi CLI", section: undefined as unknown as never, status: "error", message: "Not found", detail: "Searched PATH" },
      { name: "System Node.js", section: undefined as unknown as never, status: "ok", message: "v22 at /usr/bin/node" },
    ];
    const out = stampSectionsAndSuggestions(checks);
    expect(out[0].section).toBe("pi-tooling");
    expect(out[0].suggestion).toBeDefined();
    expect(out[1].section).toBe("runtime");
    expect(out[1].suggestion).toBeUndefined();
  });

  it("every non-ok row produced through stamping has non-empty message + detail + suggestion", () => {
    const statuses: DoctorStatus[] = ["warning", "error"];
    for (const name of ALL_CHECK_NAMES) {
      // Electron suggestion is always undefined (decision-by-design); skip.
      if (name === "Electron") continue;
      for (const status of statuses) {
        const checks: DoctorCheck[] = [
          {
            name,
            section: undefined as unknown as never,
            status,
            message: "synthetic message",
            detail: "synthetic detail",
          },
        ];
        const [stamped] = stampSectionsAndSuggestions(checks);
        expect(stamped.message.length).toBeGreaterThan(0);
        expect((stamped.detail ?? "").length).toBeGreaterThan(0);
        expect((stamped.suggestion ?? "").length).toBeGreaterThan(0);
      }
    }
  });

  it("does not overwrite an existing suggestion", () => {
    const checks: DoctorCheck[] = [
      {
        name: "pi CLI",
        section: "pi-tooling",
        status: "error",
        message: "x",
        detail: "y",
        suggestion: "custom",
      },
    ];
    const out = stampSectionsAndSuggestions(checks);
    expect(out[0].suggestion).toBe("custom");
  });
});

describe("checkAttachedServerVersion", () => {
  const fetcher = (health: { version?: string; launchSource?: string } | null) =>
    async () => health;

  it("matching versions → ok", async () => {
    const c = await checkAttachedServerVersion({
      appVersion: "0.5.3",
      healthFetcher: fetcher({ version: "0.5.3", launchSource: "electron" }),
    });
    expect(c.status).toBe("ok");
    expect(c.section).toBe("setup");
  });

  it("mismatch + standalone → warning, suggestion mentions npm", async () => {
    const c = await checkAttachedServerVersion({
      appVersion: "0.5.3",
      healthFetcher: fetcher({ version: "0.5.1", launchSource: "standalone" }),
    });
    expect(c.status).toBe("warning");
    expect(c.suggestion).toContain("npm i -g @blackbelt-technology/pi-dashboard@0.5.3");
  });

  it("mismatch + bridge → warning, suggestion mentions pi session", async () => {
    const c = await checkAttachedServerVersion({
      appVersion: "0.5.3",
      healthFetcher: fetcher({ version: "0.5.1", launchSource: "bridge" }),
    });
    expect(c.status).toBe("warning");
    expect(c.suggestion?.toLowerCase()).toContain("pi session");
  });

  it("mismatch + bridge-orphaned → same bridge suggestion", async () => {
    const c = await checkAttachedServerVersion({
      appVersion: "0.5.3",
      healthFetcher: fetcher({ version: "0.5.1", launchSource: "bridge-orphaned" }),
    });
    expect(c.status).toBe("warning");
    expect(c.suggestion?.toLowerCase()).toContain("pi session");
  });

  it("mismatch + electron → warning, suggestion mentions other Electron", async () => {
    const c = await checkAttachedServerVersion({
      appVersion: "0.5.3",
      healthFetcher: fetcher({ version: "0.5.1", launchSource: "electron" }),
    });
    expect(c.status).toBe("warning");
    expect(c.suggestion?.toLowerCase()).toContain("electron");
  });

  it("mismatch + unknown/missing launchSource → warning, source-agnostic suggestion (not electron)", async () => {
    const c = await checkAttachedServerVersion({
      appVersion: "0.5.3",
      healthFetcher: fetcher({ version: "0.5.1" }), // no launchSource
    });
    expect(c.status).toBe("warning");
    // Must NOT misattribute an unknown source to the other-Electron remedy.
    expect(c.suggestion?.toLowerCase()).not.toContain("quit the other electron");
    expect((c.suggestion ?? "").length).toBeGreaterThan(0);
  });

  it("healthFetcher returns null → error with non-empty message", async () => {
    const c = await checkAttachedServerVersion({
      appVersion: "0.5.3",
      healthFetcher: fetcher(null),
    });
    expect(c.status).toBe("error");
    expect(c.message.length).toBeGreaterThan(0);
  });

  it("healthFetcher throws → error", async () => {
    const c = await checkAttachedServerVersion({
      appVersion: "0.5.3",
      healthFetcher: async () => { throw new Error("ECONNREFUSED"); },
    });
    expect(c.status).toBe("error");
  });
});
