/**
 * E18 removal gate: no tracked file still references the retired
 * pi-anthropic-messages peer or the deleted flows-anthropic-bridge plugin,
 * outside history and a short allowlist of files that name the package on
 * purpose (the uninstall notice, its copy, and the doctor guidance).
 *
 * See change: retire-anthropic-messages-bridge (design D8, test-plan #E18).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

const PATTERN =
  /flows-anthropic-bridge|pi-anthropic-messages|anthropic-messages-source|anthropic-peer-names|ANTHROPIC_MESSAGES_SOURCE|PI_ANTHROPIC_MESSAGES|useAnthropicPeerProbe|peer-auto-install-store|PeerAutoInstallStatus|lib\/package\/anthropic-peer/;

/** History and generated corpora: never edited by a change. */
const EXCLUDED_PREFIXES = [
  "openspec/changes/archive/",
  "openspec/changes/retire-anthropic-messages-bridge/",
  // Main specs are rewritten from this change's deltas at archive time.
  "openspec/specs/",
  "Prompt stories/",
  "mockups/",
  "docs/qa/archived-",
  ".pi/dashboard/kb/",
];
const EXCLUDED_FILES = new Set([
  "CHANGELOG.md",
  "scripts/__tests__/retired-anthropic-messages-gate.test.mjs",
  "scripts/__tests__/retired-anthropic-messages-gate.test.mjs.AGENTS.md",
]);

/** Files that name the package on purpose. Each entry says why. */
const INTENDED = new Map([
  ["packages/client/src/components/settings/ClaudeCompatControls.tsx", "uninstall notice matches the package names"],
  ["packages/client/src/components/__tests__/ClaudeCompatUninstallNotice.test.tsx", "uninstall notice fixtures"],
  ["packages/client/src/lib/i18n-en-source.json", "uninstall notice copy"],
  ["packages/client/src/lib/i18n/i18n-hu.ts", "uninstall notice copy"],
  ["packages/client/src/lib/i18n/i18n-zh-CN.ts", "uninstall notice copy"],
  ["packages/shared/src/recommended-extensions.ts", "comment recording why the entry was removed"],
  ["packages/extension/.pi/skills/doctor/modules/peers.md", "doctor guidance: no longer a peer, safe to uninstall"],
  ["packages/extension/.pi/skills/doctor/modules/plugins-bridges.md", "doctor guidance: a leftover bridge entry is stale"],
  ["docs/faq.md", "uninstall guidance"],
  ["docs/faq.agent.md", "uninstall guidance"],
  ["README.md", "upgrade note: uninstall the old package"],
]);

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return out.split("\0").filter(Boolean);
}

function isExcluded(rel) {
  return EXCLUDED_FILES.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p));
}

describe("retired pi-anthropic-messages references (E18)", () => {
  const offenders = [];
  const intendedHits = new Set();
  for (const rel of trackedFiles()) {
    if (isExcluded(rel)) continue;
    const abs = path.join(REPO_ROOT, rel);
    let text;
    try {
      const stat = fs.statSync(abs);
      if (!stat.isFile() || stat.size > 2_000_000) continue;
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue; // deleted in the working tree but still in the index
    }
    if (!PATTERN.test(text)) continue;
    if (INTENDED.has(rel)) intendedHits.add(rel);
    else offenders.push(rel);
  }

  it("no tracked file references the retired peer or plugin outside the allowlist", () => {
    expect(offenders).toEqual([]);
  });

  it("the deleted plugin package is gone from the tree", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, "packages/flows-anthropic-bridge-plugin"))).toBe(false);
  });

  it("every allowlist entry still names the package (no stale exceptions)", () => {
    const stale = [...INTENDED.keys()].filter((rel) => fs.existsSync(path.join(REPO_ROOT, rel)) && !intendedHits.has(rel));
    expect(stale).toEqual([]);
  });
});
