/**
 * Skill-content invariants (#X20 Mail redirect, #X21 Messages≠email,
 * #X22 unprovisioned load names the installer). The skill is documentation, so
 * its behavioural guarantees are pinned as content assertions.
 * See change: add-apple-tools-imcp-plugin.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(
  join(here, "..", "..", ".pi", "skills", "apple-tools", "SKILL.md"),
  "utf8",
);

describe("apple-tools SKILL.md", () => {
  it("#X20: names the Mail exclusion and redirects to apple-mail-fast-export", () => {
    expect(skill).toMatch(/no Mail service/i);
    expect(skill).toContain("apple-mail-fast-export");
  });

  it("#X21: identifies Messages as iMessage/SMS, not email", () => {
    expect(skill).toMatch(/iMessage\s*\/\s*SMS/i);
    expect(skill).toMatch(/not.*email|NOT email/i);
  });

  it("#X22: names the installer command for the unprovisioned path", () => {
    expect(skill).toContain("pi-apple-tools-install");
    expect(skill).toMatch(/--check/);
  });

  it("enumerates the seven reachable services and excludes Mail from them", () => {
    for (const svc of ["Calendar", "Contacts", "Location", "Maps", "Messages", "Reminders", "Weather"]) {
      expect(skill).toContain(svc);
    }
    // The reachable-services line itself must not list Mail.
    const svcLine = skill.split("\n").find((l) => /Calendar\s+·\s+Contacts/.test(l)) ?? "";
    expect(svcLine).toContain("Weather");
    expect(svcLine).not.toContain("Mail");
  });

  it("documents TCC revocation → menu-bar remediation, not re-install", () => {
    expect(skill).toMatch(/menu-bar remediation/i);
    expect(skill).toMatch(/cannot be automated/i);
  });
});
