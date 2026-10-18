/**
 * Static contents of an installed pi package: `package.json#name` plus how many
 * extensions / skills / prompts / themes it ships. Tools are registered at
 * runtime by extensions and are deliberately not counted (design D9).
 *
 * Reads the `pi` manifest of `package.json` when present, else pi's convention
 * directories (`extensions/`, `skills/`, `prompts/`, `themes/`). Never throws.
 * See change: addons-hub-feature-catalog.
 */
import fs from "node:fs";
import path from "node:path";
import type { AddonPackageContents } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

export interface PackageInfo {
  name?: string;
  contents: AddonPackageContents;
}

type Kind = keyof AddonPackageContents;
const KINDS: readonly Kind[] = ["extensions", "skills", "prompts", "themes"];
const EXT_FILE = /\.(?:[cm]?[jt]s)$/;

/** Does one directory entry count as an item of `kind`? */
function entryCounts(target: string, e: fs.Dirent, kind: Kind): boolean {
	if (e.name.startsWith(".") || e.name === "node_modules") return false;
	switch (kind) {
		case "skills":
			return e.isDirectory() ? fs.existsSync(path.join(target, e.name, "SKILL.md")) : e.isFile() && e.name.endsWith(".md");
		case "prompts":
			return e.isFile() && e.name.endsWith(".md");
		case "themes":
			return e.isFile() && e.name.endsWith(".json");
		default:
			return e.isFile() ? EXT_FILE.test(e.name) : e.isDirectory();
	}
}

/** Count the items under one manifest path / convention dir. */
function countAt(target: string, kind: Kind): number {
	try {
		if (fs.statSync(target).isFile()) return 1;
		return fs.readdirSync(target, { withFileTypes: true }).filter((e) => entryCounts(target, e, kind)).length;
	} catch {
		return 0;
	}
}

export function readPackageInfo(installedPath: string | undefined): PackageInfo {
  const contents: AddonPackageContents = { extensions: 0, skills: 0, prompts: 0, themes: 0 };
  if (!installedPath) return { contents };
  let pkg: { name?: unknown; pi?: Record<string, unknown> } = {};
  try {
    const stat = fs.statSync(installedPath);
    // A single file source (e.g. a bridge entry) is one extension, no manifest.
    if (stat.isFile()) return { contents: { ...contents, extensions: 1 } };
    pkg = JSON.parse(fs.readFileSync(path.join(installedPath, "package.json"), "utf-8"));
  } catch {
    /* no readable package.json → convention dirs only */
  }
  const name = typeof pkg.name === "string" ? pkg.name : undefined;
  const manifest = pkg.pi && typeof pkg.pi === "object" ? pkg.pi : undefined;
  for (const kind of KINDS) {
    const declared = manifest?.[kind];
    const paths = Array.isArray(declared)
      ? declared.filter((p): p is string => typeof p === "string")
      : [kind];
    contents[kind] = paths.reduce((sum, p) => sum + countAt(path.resolve(installedPath, p), kind), 0);
  }
  return { name, contents };
}
