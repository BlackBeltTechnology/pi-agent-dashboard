/**
 * Next-steps text printed after a successful scaffold run. Pure: builds a string, never spawns or runs
 * anything — the user runs every step (spec `dashboard-plugin-skill`, "prints next-steps and never auto-runs them").
 * See change: decouple-plugins-from-core (tasks 7.9, 8.136).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { Answers } from "./render.js";

const HOST_STYLE_STEP = "Style plugin UI with host tokens only: read references/host-design.md (surfaces, severity/status, accent-text, both modes, no own theme/fonts).";

/** The package name an augmented project publishes under (`<package>` when unreadable). */
function augmentPackageName(outDir: string): string {
  try {
    const name = (JSON.parse(fs.readFileSync(path.join(outDir, "package.json"), "utf8")) as { name?: unknown }).name;
    return typeof name === "string" && name ? name : "<package>";
  } catch {
    return "<package>";
  }
}

function numbered(steps: string[]): string {
  return ["Next steps:", ...steps.map((s, i) => `  ${i + 1}. ${s}`)].join("\n");
}

/** The numbered next-steps for a finished run of either mode. */
export function nextSteps(answers: Answers): string {
  if (answers.mode === "new") {
    return numbered([
      "cd <dashboard-repo> && npm install",
      "npm run build                 # build the client + plugin",
      "curl -X POST http://localhost:8000/api/restart   # restart the dashboard server (or: pi-dashboard restart)",
      "npm run reload                # reload all connected pi sessions",
      "Open the dashboard, navigate to your slot, see the scaffold render.",
      HOST_STYLE_STEP,
    ]);
  }
  const pkg = augmentPackageName(answers.outDir);
  return numbered([
    "npm install",
    "npm run build                 # build your project (the original TUI surface still works in pi)",
    "npm run build:dashboard       # build the dashboard client bundle into dist/client/",
    `Publish: npm publish   # the package must carry dist/client/ and src/dashboard/ (check "files" and .npmignore)`,
    `Install it globally: pi install npm:${pkg} from a terminal (the dashboard shows it after a dashboard restart), or use the dashboard Packages tab (it shows the package live).`,
    "Until it is published: npm link the project into the dashboard's packages/ layout (cd <dashboard-repo> && npm link <your-package-path>), or clone it into <dashboard-repo>/packages/ as a workspace.",
    "Trust: the plugin runs only after the operator trusts its client bundle (and, for a server entry, grants server trust) from the Plugins tab on the dashboard host itself.",
    HOST_STYLE_STEP,
  ]);
}
