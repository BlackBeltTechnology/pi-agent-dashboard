/**
 * Project-profile resolver for the `project-init` skill.
 *
 * A profile is a directory bundle:
 *   <profile>/
 *     profile.json      — { name, description?, dox? }  (dox defaults false)
 *     AGENTS.md.tmpl     — instructions template
 *     settings.json.tmpl — `.pi/settings.json` template (worktreeInit hook + toolset)
 *     prompts/*.md       — separate, individually-editable prompt files
 *
 * Resolution order (later wins on name collision):
 *   1. <skill>/profiles/*          shipped defaults (coding, docs)
 *   2. ~/.pi/project-profiles/*    user profiles / overrides
 *
 * A user profile fully shadows a shipped profile of the same name.
 * Project-local (`./.pi/`) is NOT a resolution source (the project is not
 * configured yet — chicken/egg).
 *
 * See change: project-init-skill-and-profiles.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface Profile {
  /** Directory name (the profile key). */
  name: string;
  /** One-line description surfaced by the skill's picker. */
  description?: string;
  /** DOX opt-in. Default false. */
  dox: boolean;
  /**
   * When true, the profile's templates carry technology placeholders
   * (`{{INSTALL_CMD}}` / `{{INIT_GATE}}` …) that the skill fills from a
   * detected + user-confirmed stack (`detect-stack.ts`). Default false.
   */
  stackAware: boolean;
  /** Absolute path to the profile directory. */
  dir: string;
  /** Where the profile was resolved from. */
  source: "shipped" | "user";
}

export interface ResolveProfilesOptions {
  /** Override the shipped profiles dir (tests). Defaults to `<skill>/profiles`. */
  shippedDir?: string;
  /** Override the user profiles dir (tests). Defaults to `~/.pi/project-profiles`. */
  userDir?: string;
}

/** Absolute path to the shipped `profiles/` directory next to the skill. */
export function shippedProfilesDir(): string {
  // This module is bundled under `src/project-init/`; the shipped skill
  // profiles live at `<pkg>/.pi/skills/project-init/profiles`.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkgRoot = path.resolve(here, "..", "..");
  return path.join(pkgRoot, ".pi", "skills", "project-init", "profiles");
}

/** Default user profiles directory. */
export function userProfilesDir(): string {
  return path.join(os.homedir(), ".pi", "project-profiles");
}

/**
 * Read one profile directory into a `Profile`, or `null` when it is not a
 * usable profile (missing dir / not a directory / missing required
 * templates). `profile.json` is optional — its absence yields a profile
 * named after the dir with `dox: false`.
 */
export function readProfile(dir: string, source: "shipped" | "user"): Profile | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dir);
  } catch {
    return null;
  }
  if (!stat.isDirectory()) return null;
  const name = path.basename(dir);
  // A profile MUST carry the two templates to be scaffoldable.
  if (!fs.existsSync(path.join(dir, "AGENTS.md.tmpl"))) return null;
  if (!fs.existsSync(path.join(dir, "settings.json.tmpl"))) return null;

  let description: string | undefined;
  let dox = false;
  let stackAware = false;
  const manifestPath = path.join(dir, "profile.json");
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as { description?: unknown; dox?: unknown; stackAware?: unknown };
    if (typeof parsed.description === "string") description = parsed.description;
    if (parsed.dox === true) dox = true;
    if (parsed.stackAware === true) stackAware = true;
  } catch {
    // No manifest / unreadable / bad JSON → defaults (dox/stackAware false, no description).
  }

  return { name, description, dox, stackAware, dir, source };
}

/** Enumerate the immediate profile subdirectories of `root`. */
function listProfileDirs(root: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(root, e.name))
    .sort();
}

/**
 * Resolve the merged profile set: shipped defaults overlaid by user profiles,
 * user-wins-by-name. Returned sorted by name.
 */
export function resolveProfiles(opts: ResolveProfilesOptions = {}): Profile[] {
  const shippedDir = opts.shippedDir ?? shippedProfilesDir();
  const userDir = opts.userDir ?? userProfilesDir();

  const byName = new Map<string, Profile>();
  for (const dir of listProfileDirs(shippedDir)) {
    const p = readProfile(dir, "shipped");
    if (p) byName.set(p.name, p);
  }
  // User profiles overlay shipped ones of the same name.
  for (const dir of listProfileDirs(userDir)) {
    const p = readProfile(dir, "user");
    if (p) byName.set(p.name, p);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
