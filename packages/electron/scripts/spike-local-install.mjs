#!/usr/bin/env node
/**
 * Spike for bundle-first-party-extensions task 1.2.
 *
 * Verifies how pi's DefaultPackageManager handles a "local:" source:
 *   - Does install() mutate the filesystem?
 *   - Does addSourceToSettings() persist the local path or the original git URL?
 *
 * Uses a throwaway agentDir under /tmp so user settings are not touched.
 * Invoke:  node packages/electron/scripts/spike-local-install.mjs
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

// Resolve pi-coding-agent from npm -g root (global install, scoped package).
const npmGlobalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
const piPkgDir = join(npmGlobalRoot, "@earendil-works", "pi-coding-agent");
console.log("pi-coding-agent dir:", piPkgDir);
const piRequire = createRequire(join(piPkgDir, "package.json"));
// Resolve pi's internal files via its own require root so transitive imports work.
const pmUrl = "file://" + piRequire.resolve("./dist/core/package-manager.js");
const smUrl = "file://" + piRequire.resolve("./dist/core/settings-manager.js");
const { DefaultPackageManager } = await import(pmUrl);
const { SettingsManager } = await import(smUrl);

const tmpRoot = mkdtempSync(join(tmpdir(), "pi-spike-"));
const agentDir = join(tmpRoot, "agent");
const cwd = join(tmpRoot, "cwd");
mkdirSync(agentDir, { recursive: true });
mkdirSync(cwd, { recursive: true });
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [] }, null, 2));

// Fabricate a minimal "bundled" extension tree (avoid network).
const bundleSrc = join(tmpRoot, "bundle", "pi-anthropic-messages");
mkdirSync(bundleSrc, { recursive: true });
writeFileSync(join(bundleSrc, "package.json"), JSON.stringify({ name: "pi-anthropic-messages", version: "0.0.0" }, null, 2));

console.log("\n--- Scenario A: installAndPersist('local:<path>') ---");
const settings = SettingsManager.create(cwd, agentDir);
const manager = new DefaultPackageManager({ cwd, agentDir, settingsManager: settings });

// Note: pi parseSource treats `local:` as a generic path (no scheme). Pass the bare path.
await manager.installAndPersist(bundleSrc, { local: false });

console.log("settings.json after local install:");
console.log(readFileSync(join(agentDir, "settings.json"), "utf8"));

console.log("\nContents of agentDir:");
for (const entry of execSync(`find "${agentDir}" -maxdepth 4`, { encoding: "utf8" }).split("\n")) {
  console.log("  ", entry);
}

console.log("\n--- Scenario B: addSourceToSettings(gitUrl) after copy into git/ cache ---");
// Reset settings
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [] }, null, 2));
const settings2 = SettingsManager.create(cwd, agentDir);
const manager2 = new DefaultPackageManager({ cwd, agentDir, settingsManager: settings2 });

const gitUrl = "https://github.com/BlackBeltTechnology/pi-anthropic-messages.git";
const gitCache = join(agentDir, "git", "github.com", "BlackBeltTechnology", "pi-anthropic-messages");
mkdirSync(join(agentDir, "git"), { recursive: true });
cpSync(bundleSrc, gitCache, { recursive: true });
const added = manager2.addSourceToSettings(gitUrl, { local: false });
console.log("addSourceToSettings returned:", added);
await settings2.flush();
console.log("settings.json after git URL register (post-flush):");
console.log(readFileSync(join(agentDir, "settings.json"), "utf8"));

const installed = manager2.getInstalledPath(gitUrl, "user");
console.log("manager.getInstalledPath(gitUrl, 'user'):", installed);

const configured = manager2.listConfiguredPackages();
console.log("manager.listConfiguredPackages():", JSON.stringify(configured, null, 2));

// Cleanup
rmSync(tmpRoot, { recursive: true, force: true });
console.log("\nDone. tmpRoot cleaned up.");
