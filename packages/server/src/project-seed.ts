/**
 * Unattended project-default seeding.
 *
 * A directory the dashboard knows about but that carries no `.pi/settings.json`
 * renders as "not initialized" (`buildSetupChecklist` in
 * `routes/git-routes.ts`). Historically the only cure was the INTERACTIVE
 * `project-init` skill, so every folder a user pinned stayed unconfigured until
 * they ran it by hand. This module seeds the same artifacts the skill writes,
 * without a prompt, from the trigger points where a directory first becomes
 * known to the server.
 *
 * What it writes — the shipped `coding` profile (stack-aware + DOX), gap-filled:
 *   <root>/AGENTS.md                          (only when absent)
 *   <root>/.pi/settings.json                  (stack-detected `worktreeInit`)
 *   <root>/.pi/prompts/*.md
 *   <root>/.pi/dashboard/knowledge_base.json  (DOX kb toolset)
 *
 * Non-destructive by construction: `scaffoldProfile({ skipExisting: true })`
 * writes only ABSENT files and never mutates a pre-existing AGENTS.md (not even
 * the append-only doctrine block). A `~/.pi/project-profiles/coding` profile
 * shadows the shipped one, so the seeded defaults are user-overridable.
 *
 * Refusals (never seeded): a path that is not a directory, `$HOME`, a
 * filesystem root. Seeding is keyed by resolved CONFIG ROOT — the same root the
 * checklist stats — so every worktree of one repo collapses to a single seed,
 * and an in-process `Set` makes repeat triggers free.
 *
 * Every failure is swallowed and reported in the outcome: seeding is a
 * convenience, never a reason for a pin / session registration to fail.
 *
 * See change: auto-seed-project-defaults.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  detectStack,
  stackSubstitutions,
} from "@blackbelt-technology/pi-dashboard-extension/project-init/detect-stack.js";
import {
  type Profile,
  resolveProfiles,
} from "@blackbelt-technology/pi-dashboard-extension/project-init/profiles.js";
import {
  planScaffold,
  scaffoldProfile,
} from "@blackbelt-technology/pi-dashboard-extension/project-init/scaffold.js";
import { resolveConfigRoot } from "./git-worktree/git-operations.js";

/** Profile seeded for every project. User-shadowable via `~/.pi/project-profiles/coding`. */
const SEED_PROFILE_NAME = "coding";

/**
 * Substitutions for a directory whose stack `detect-stack` could not identify.
 * The `worktreeInit` hook must stay structurally valid (an unfilled
 * `{{INIT_GATE}}` would be stored as a literal gate), so it is rendered INERT:
 * gate `false` never exits 0, hence `evaluateGate` reports `needsInit: false`
 * and the command never runs. The command placeholders land inside a fenced
 * bash block in AGENTS.md, where `#` is a comment.
 */
const NO_STACK_SUBSTITUTIONS: Record<string, string> = {
  INSTALL_CMD: "# TODO: install command",
  TEST_CMD: "# TODO: test command",
  BUILD_CMD: "# TODO: build command",
  INIT_GATE: "false",
  INIT_COMMAND: "true",
};

export interface SeedOutcome {
  /** Resolved config root that was (or would have been) seeded; null when unresolvable. */
  root: string | null;
  /** True when at least one artifact was written. */
  seeded: boolean;
  /** Absolute paths written by this call. */
  written: string[];
  /** Absolute paths left untouched because they already existed. */
  skipped: string[];
  /** Present when nothing was attempted / the attempt failed. */
  reason?: string;
}

export interface SeedProjectDefaultsOptions {
  /** Override the profile set (tests). Defaults to the resolved shipped ∪ user profiles. */
  profiles?: Profile[];
  /** Treat this as `$HOME` (tests). */
  homeDir?: string;
  /** Skip the already-seeded memo (tests). */
  force?: boolean;
}

/** Config roots already seeded in this process. */
const seededRoots = new Set<string>();

/**
 * Boot-time switch mirroring `DashboardConfig.autoSeedProjects`. Module-level
 * because the three trigger points (pin handler, session registration, boot
 * sweep) sit behind surfaces that carry no `DashboardConfig` — threading it
 * through `BrowserHandlerContext` would touch far more than this change needs.
 * Set once in `createServer`; defaults to the config default so a host that
 * never calls it behaves per spec.
 */
let autoSeedEnabled = true;

/** Apply `DashboardConfig.autoSeedProjects`. Called once at server boot. */
export function configureProjectSeed(enabled: boolean): void {
  autoSeedEnabled = enabled;
}

/** Test seam — clears the per-process memo and re-enables seeding. */
export function resetSeededRoots(): void {
  seededRoots.clear();
  autoSeedEnabled = true;
}

/**
 * Fire-and-forget seed, deferred one tick. `seedProjectDefaults` is synchronous
 * and its config-root probe spawns git, so the trigger points (a pin handler, a
 * bridge registration) must not pay for it inline. Never throws.
 */
export function scheduleProjectSeed(dir: string): void {
  if (!autoSeedEnabled) return;
  setImmediate(() => {
    const outcome = seedProjectDefaults(dir);
    if (outcome.seeded) {
      console.log(`[project-seed] seeded ${outcome.root} (${outcome.written.length} file(s))`);
    }
  });
}

const skip = (root: string | null, reason: string): SeedOutcome => ({
  root,
  seeded: false,
  written: [],
  skipped: [],
  reason,
});

/**
 * Seed the `coding` profile's missing artifacts into `dir`'s config root.
 * Never throws. Idempotent: a second call on the same root short-circuits on
 * the memo, and even without it `skipExisting` makes the write set empty.
 */
export function seedProjectDefaults(
  dir: string,
  opts: SeedProjectDefaultsOptions = {},
): SeedOutcome {
  try {
    if (!autoSeedEnabled) return skip(null, "disabled");
    if (!dir) return skip(null, "empty path");
    let stat: fs.Stats;
    try {
      stat = fs.statSync(dir);
    } catch {
      return skip(null, "not found");
    }
    if (!stat.isDirectory()) return skip(null, "not a directory");

    // The checklist stats the CONFIG ROOT, so seed there; a bare directory that
    // is not a git checkout seeds itself.
    const root = path.resolve(resolveConfigRoot(dir) ?? dir);

    const home = path.resolve(opts.homeDir ?? os.homedir());
    if (root === home) return skip(root, "refusing to seed $HOME");
    if (root === path.parse(root).root) return skip(root, "refusing to seed filesystem root");

    if (!opts.force && seededRoots.has(root)) return skip(root, "already seeded");

    const profiles = opts.profiles ?? resolveProfiles();
    const profile = profiles.find((p) => p.name === SEED_PROFILE_NAME);
    if (!profile) return skip(root, `profile "${SEED_PROFILE_NAME}" unavailable`);

    // Short-circuit a fully-configured project before stack detection — the
    // overwhelmingly common case on every trigger.
    if (isFullySeeded(profile, root)) {
      seededRoots.add(root);
      return skip(root, "already configured");
    }

    const stack = detectStack(root);
    const substitutions = stack ? stackSubstitutions(stack) : NO_STACK_SUBSTITUTIONS;

    const result = scaffoldProfile({
      profile,
      targetDir: root,
      substitutions,
      skipExisting: true,
    });

    seededRoots.add(root);
    const skippedSet = new Set(result.skipped);
    const written = result.writes.filter((p) => !skippedSet.has(p));
    return { root, seeded: written.length > 0, written, skipped: result.skipped };
  } catch (err) {
    return skip(null, `seed failed: ${(err as Error).message}`);
  }
}

/** True when every artifact the seed would write is already present. */
/**
 * True when every file the profile would write already exists — checked per
 * planned file (each prompt individually), so a partial `.pi/prompts/` or a
 * user-shadowed profile with different prompts is still gap-filled.
 */
function isFullySeeded(profile: Profile, root: string): boolean {
  const plan = planScaffold({ profile, targetDir: root });
  return plan.conflicts.length === plan.writes.length;
}

/**
 * Boot sweep over the directories the dashboard already knows about (pinned
 * dirs + workspace folders). Each directory is deferred onto its own tick so a
 * large pin list cannot stall startup with a burst of sync git probes.
 */
export function sweepKnownProjects(dirs: Iterable<string>): void {
  for (const dir of dirs) scheduleProjectSeed(dir);
}
