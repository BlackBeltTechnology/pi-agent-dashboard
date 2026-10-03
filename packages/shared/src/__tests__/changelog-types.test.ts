/**
 * Type-only assertions for changelog-types. The runtime body is a
 * single `expect(true).toBe(true)` — the real test is that the
 * `const x: T = {...}` literal blocks compile under `tsc --noEmit`
 * during the normal test run.
 *
 * See change: pi-update-whats-new-panel.
 */
import { describe, it, expect } from "vitest";
import type {
  ChangelogBullet,
  ChangelogRelease,
  ChangelogResponse,
} from "../changelog-types.js";

describe("changelog-types", () => {
  it("ChangelogBullet accepts minimal and full shapes", () => {
    const minimal: ChangelogBullet = { text: "fix a bug", issues: [] };
    const full: ChangelogBullet = {
      text: "fix a bug ([#3588](https://github.com/x/y/issues/3588))",
      issues: [{ num: 3588, url: "https://github.com/x/y/issues/3588" }],
    };
    expect(minimal.text).toBe("fix a bug");
    expect(full.issues[0].num).toBe(3588);
  });

  it("ChangelogRelease accepts a fully populated entry", () => {
    const rel: ChangelogRelease = {
      version: "0.70.0",
      date: "2026-04-23",
      breaking: [{ text: "...", issues: [] }],
      features: [{ text: "...", issues: [] }],
      changed: [],
      fixed: [{ text: "...", issues: [] }],
      raw: "## [0.70.0] - 2026-04-23\n\n…",
    };
    expect(rel.version).toBe("0.70.0");
  });

  it("ChangelogRelease tolerates null date", () => {
    const rel: ChangelogRelease = {
      version: "0.0.1",
      date: null,
      breaking: [],
      features: [],
      changed: [],
      fixed: [],
      raw: "",
    };
    expect(rel.date).toBeNull();
  });

  it("ChangelogResponse wraps a release list", () => {
    const resp: ChangelogResponse = {
      pkg: "@earendil-works/pi-coding-agent",
      from: "0.62.0",
      to: "0.70.0",
      releases: [],
      hasBreaking: false,
      changelogUrl: null,
      parsedAt: "2026-05-08T12:00:00.000Z",
    };
    expect(resp.releases).toHaveLength(0);
  });

  it("ChangelogResponse allows null changelogUrl", () => {
    const resp: ChangelogResponse = {
      pkg: "x",
      from: "1.0.0",
      to: "1.0.1",
      releases: [],
      hasBreaking: false,
      changelogUrl: null,
      parsedAt: new Date().toISOString(),
    };
    expect(resp.changelogUrl).toBeNull();
  });
});
