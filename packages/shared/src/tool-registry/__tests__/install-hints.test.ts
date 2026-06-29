/**
 * install-hints.test.ts — asserts the `installHints` metadata contract.
 *
 * Every user-installable binary tool MUST ship per-OS install guidance,
 * every populated platform hint MUST carry at least one actionable field,
 * and every `docsAnchor` MUST point at a real heading anchor in
 * docs/faq.md (so the UI's "Read more in docs ↗" link never 404s).
 *
 * See change: register-bash-and-tool-install-help.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ToolRegistry,
  registerDefaultTools,
  OverridesStore,
} from "../index.js";
import type { InstallHints, ToolListEntry } from "../types.js";

/** Binary tools that are genuinely user-installable (have an install story). */
const USER_INSTALLABLE = ["bash", "gh", "zrok", "git", "node"] as const;
const OSES = ["darwin", "win32", "linux"] as const satisfies readonly (keyof InstallHints)[];

/** Platform-utility binaries that ship with the OS — must NOT carry hints. */
const PLATFORM_UTILITIES = ["powershell", "tasklist", "taskkill", "ps", "pgrep", "wt"];

function freshList(platform: NodeJS.Platform): ToolListEntry[] {
  const store = new OverridesStore({
    filePath: path.join(os.tmpdir(), `install-hints-test-${Math.random()}.json`),
    warn: () => {},
  });
  const r = new ToolRegistry({ overrides: store, platform });
  registerDefaultTools(r, {
    exists: () => false,
    which: () => null,
    npmRootGlobal: () => "",
    resolveModule: () => null,
  });
  return r.list();
}

/** Walk up from this file until docs/faq.md is found; return its contents. */
function readFaq(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    const candidate = path.join(dir, "docs", "faq.md");
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate, "utf8");
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("could not locate docs/faq.md by walking up from the test file");
}

/** GitHub-style heading → anchor slug. "## Install bash" → "install-bash". */
function headingAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  for (const line of markdown.split("\n")) {
    const m = /^#{2,3}\s+(.*)$/.exec(line.trim());
    if (!m) continue;
    const slug = m[1]
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");
    anchors.add(slug);
  }
  return anchors;
}

describe("install hints metadata", () => {
  const list = freshList("linux");
  const byName = new Map(list.map((t) => [t.name, t]));

  for (const name of USER_INSTALLABLE) {
    it(`${name} ships installHints for darwin, win32, and linux`, () => {
      const entry = byName.get(name);
      expect(entry, `${name} should be registered`).toBeDefined();
      expect(entry!.installHints, `${name} should declare installHints`).toBeDefined();
      for (const o of OSES) {
        const hint = entry!.installHints![o];
        expect(hint, `${name}.installHints.${o} should be present`).toBeDefined();
        const actionable =
          (hint!.commands && Object.keys(hint!.commands).length > 0) ||
          !!hint!.manual ||
          !!hint!.url;
        expect(actionable, `${name}.installHints.${o} needs commands|manual|url`).toBe(true);
      }
    });
  }

  it("bash win32 lists at least one of winget/choco/scoop", () => {
    const bash = byName.get("bash");
    const cmds = bash?.installHints?.win32?.commands ?? {};
    const keys = Object.keys(cmds);
    expect(keys.some((k) => ["winget", "choco", "scoop"].includes(k))).toBe(true);
  });

  it("platform-utility tools do NOT ship installHints", () => {
    // wt registers on every platform; the rest are platform-gated, so
    // probe both tool sets.
    for (const platform of ["linux", "win32"] as NodeJS.Platform[]) {
      const m = new Map(freshList(platform).map((t) => [t.name, t]));
      for (const name of PLATFORM_UTILITIES) {
        const entry = m.get(name);
        if (!entry) continue; // not registered on this platform
        expect(entry.installHints, `${name} must not carry installHints`).toBeUndefined();
      }
    }
  });

  it("every docsAnchor corresponds to a heading anchor in docs/faq.md", () => {
    const anchors = headingAnchors(readFaq());
    for (const name of USER_INSTALLABLE) {
      const docsAnchor = byName.get(name)?.installHints?.docsAnchor;
      expect(docsAnchor, `${name} should declare a docsAnchor`).toBeTruthy();
      expect(
        anchors.has(docsAnchor!),
        `docsAnchor "${docsAnchor}" (tool ${name}) missing from docs/faq.md headings`,
      ).toBe(true);
    }
  });
});
