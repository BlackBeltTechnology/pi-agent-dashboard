/**
 * @structural-pin locale catalog text is the contract: the keys must literally exist in each catalog source file
 *
 * The Windows "Bash for agent commands" copy and the new Doctor code text ship
 * in every locale catalog. English lives in i18n-en-source.json for UI keys; the
 * `err.doctor.*` codes carry their English at the call site (doctor-core), so
 * they are catalogued in hu + zh-CN only (same as `err.doctor.no_posix_shell`).
 *
 * See change: fix-windows-bundled-bash-exe (test-plan #E32).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

function findClientRoot(start: string): string {
  const marker = join("src", "lib", "i18n", "i18n.tsx");
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, marker))) return dir;
    if (existsSync(join(dir, "packages", "client", marker))) return join(dir, "packages", "client");
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return start;
}

const root = findClientRoot(process.cwd());
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const en = JSON.parse(read("src/lib/i18n-en-source.json")) as Record<string, string>;
const hu = read("src/lib/i18n/i18n-hu.ts");
const zh = read("src/lib/i18n/i18n-zh-CN.ts");

const escapeRe = (k: string) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const UI_KEYS = ["git.bashSource", "git.bashSourceBundled", "git.bashSourceHost", "git.bashSourceHint"] as const;

describe("windowsBashSource i18n keys (E32)", () => {
  for (const key of UI_KEYS) {
    it(`${key} is present and non-empty in en-source, hu and zh-CN`, () => {
      expect(en[key]).toBeTruthy();
      expect(hu).toMatch(new RegExp(`"${escapeRe(key)}":\\s*"[^"]+`));
      expect(zh).toMatch(new RegExp(`"${escapeRe(key)}":\\s*"[^"]+`));
    });
  }

  it("err.doctor.bash_is_wsl_launcher is catalogued in hu and zh-CN", () => {
    expect(hu).toMatch(/"err\.doctor\.bash_is_wsl_launcher":\s*"[^"]+/);
    expect(zh).toMatch(/"err\.doctor\.bash_is_wsl_launcher":\s*"[^"]+/);
  });
});
