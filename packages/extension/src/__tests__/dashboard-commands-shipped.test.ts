/**
 * Asserts the `/dashboard:*` slash-command templates ship inside the
 * extension-bundled pi-dashboard skill (the copy declared in package.json
 * `pi.skills` + `files`, baked into the npm tarball and Docker image) — NOT
 * only the repo-root working copy.
 *
 * See change: add-dashboard-slash-commands.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..", "..");
const commandsDir = path.join(pkgDir, ".pi", "skills", "pi-dashboard", "commands");
const pkgJson = JSON.parse(
  fs.readFileSync(path.join(pkgDir, "package.json"), "utf-8"),
) as { pi?: { skills?: string[] }; files?: string[] };

function dashboardCommandFiles(): string[] {
  return fs.readdirSync(commandsDir).filter((f) => f.startsWith("dashboard-") && f.endsWith(".md"));
}

describe("dashboard slash commands — shipped in extension skill", () => {
  it("commands dir exists with at least 30 dashboard-*.md templates", () => {
    expect(fs.existsSync(commandsDir)).toBe(true);
    expect(dashboardCommandFiles().length).toBeGreaterThanOrEqual(30);
  });

  it("ships at least 13 LLM-free (executable: bash) templates", () => {
    const execCount = dashboardCommandFiles().filter((f) =>
      /^---\n[\s\S]*?executable:\s*bash[\s\S]*?\n---/.test(
        fs.readFileSync(path.join(commandsDir, f), "utf-8"),
      ),
    ).length;
    expect(execCount).toBeGreaterThanOrEqual(13);
  });

  it("package.json declares the pi-dashboard skill and ships it", () => {
    expect(pkgJson.pi?.skills ?? []).toContain(".pi/skills/pi-dashboard");
    expect(pkgJson.files ?? []).toContain(".pi/skills/pi-dashboard/");
  });

  it("ships the slash-commands reference + commands README", () => {
    expect(fs.existsSync(path.join(commandsDir, "README.md"))).toBe(true);
    expect(
      fs.existsSync(
        path.join(pkgDir, ".pi", "skills", "pi-dashboard", "references", "slash-commands.md"),
      ),
    ).toBe(true);
  });
});
