import { execFileSync } from "node:child_process";
import { expect, test } from "./fixtures.js";
import { resolveContainer } from "./helpers/container-proc.js";
import { FIXTURE_GIT, gotoDashboard, spawnFreshGitSession } from "./helpers/index.js";
import { closeSessionMenu, flowMenuItem, openSessionMenu } from "./helpers/session-actions-menu.js";

// Change: stop-flows-edit-mode-project-writes — L3 against the REAL pi-flows
// engine (>= 0.8.1, baked by docker/Dockerfile). The dashboard never writes a
// repo's `.pi/settings.json` on its own; the global toggle writes
// `~/.pi/agent/settings.json`; only the explicit per-project menu item writes
// the repo file (through pi-flows).
//
// F3: global on → open dashboard, card renders, reload twice → repo unchanged,
//     New / Edit… offered.
// F4: idle session, nothing set → Settings › Plugins › Flows → Edit mode on →
//     Save → global file has flows.editFlow:true, repo unchanged, New / Edit…
//     appears without a prompt.
// F5: two sessions in one cwd, effective off → A "Turn on edit mode for this
//     project" → repo file flows.editFlow:true, B's label flips without reload,
//     global unchanged.
//
// Shared container: every test snapshots and restores both settings files.

const GLOBAL = '"$HOME/.pi/agent/settings.json"';
const PROJECT = `"${FIXTURE_GIT}/.pi/settings.json"`;

const sh = (script: string): string =>
  execFileSync("docker", ["exec", resolveContainer(), "bash", "-c", script], { encoding: "utf8" }).trim();

const snapshot = (file: string): string => sh(`if [ -f ${file} ]; then base64 -w0 ${file}; else echo ABSENT; fi`);
const restore = (file: string, snap: string): void => {
  sh(snap === "ABSENT" ? `rm -f ${file}` : `mkdir -p "$(dirname ${file})" && echo '${snap}' | base64 -d > ${file}`);
};
const readJson = (file: string): Record<string, unknown> | null => {
  const raw = sh(`cat ${file} 2>/dev/null || true`);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
};
const editFlowOf = (file: string): unknown => (readJson(file)?.flows as { editFlow?: unknown } | undefined)?.editFlow;

/** Set (`true`/`false`) or drop (`unset`, only when the file exists) `flows.editFlow`. */
const NODE_SET =
  'const fs=require("fs"),p=require("path");const[f,v]=process.argv.slice(1);' +
  'if(v==="unset"&&!fs.existsSync(f))process.exit(0);' +
  'let o={};try{o=JSON.parse(fs.readFileSync(f,"utf8"))}catch{}' +
  'o.flows=o.flows&&typeof o.flows==="object"?o.flows:{};delete o.flowsEditFlow;' +
  'if(v==="unset"){delete o.flows.editFlow;if(!Object.keys(o.flows).length)delete o.flows}else o.flows.editFlow=v==="true";' +
  'fs.mkdirSync(p.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2)+"\\n")';
const setFlag = (file: string, v: "true" | "false" | "unset") => sh(`node -e '${NODE_SET}' ${file} ${v}`);

/** Repo state that must not move: porcelain status + settings bytes + skill dir. */
const repoState = () => ({
  status: sh(`git -C ${FIXTURE_GIT} status --porcelain`),
  settings: snapshot(PROJECT),
  skill: sh(`ls -A ${FIXTURE_GIT}/.pi/skills/manage-flows 2>/dev/null || echo ABSENT`),
});

let saved: { global: string; project: string };
test.beforeEach(() => {
  saved = { global: snapshot(GLOBAL), project: snapshot(PROJECT) };
});
test.afterEach(() => {
  restore(GLOBAL, saved.global);
  restore(PROJECT, saved.project);
});

test.describe("flows edit mode never writes the repo implicitly (L3: real pi-flows)", () => {
  test("F3: global on → open + reload twice → repo unchanged, New / Edit… offered", async ({ page }) => {
    setFlag(PROJECT, "unset");
    setFlag(GLOBAL, "true");
    const before = repoState();

    const card = await spawnFreshGitSession(page);
    await openSessionMenu(page, card);
    await expect(flowMenuItem(page, /new \/ edit/i)).toBeVisible({ timeout: 60_000 });
    await closeSessionMenu(page);

    for (let i = 0; i < 2; i++) {
      await page.reload();
      await gotoDashboard(page);
      await expect(card).toBeVisible({ timeout: 30_000 });
    }
    await openSessionMenu(page, card);
    await expect(flowMenuItem(page, /new \/ edit/i)).toBeVisible({ timeout: 30_000 });
    expect(repoState()).toEqual(before);
  });

  test("F4: Settings › Flows Edit mode on → global file written, repo clean, New / Edit… shown", async ({ page }) => {
    setFlag(PROJECT, "unset");
    setFlag(GLOBAL, "unset");
    const before = repoState();

    const card = await spawnFreshGitSession(page);
    await openSessionMenu(page, card);
    await expect(flowMenuItem(page, /turn on edit mode for this project/i)).toBeVisible({ timeout: 60_000 });
    await expect(flowMenuItem(page, /new \/ edit/i)).toHaveCount(0);
    await closeSessionMenu(page);

    const prompts: string[] = [];
    page.on("websocket", (ws) =>
      ws.on("framesent", (f) => {
        const s = typeof f.payload === "string" ? f.payload : "";
        if (s.includes('"send_prompt"')) prompts.push(s);
      }),
    );

    await page.goto("/settings/plugins/flows");
    const toggle = page.getByTestId("flows-edit-mode-toggle");
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await page.getByTestId("save-btn").click();
    await expect(page.getByTestId("settings-save-bar")).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(() => editFlowOf(GLOBAL), { timeout: 15_000 }).toBe(true);

    await gotoDashboard(page);
    await openSessionMenu(page, card);
    await expect(flowMenuItem(page, /new \/ edit/i)).toBeVisible({ timeout: 30_000 });
    expect(prompts).toEqual([]);
    expect(repoState()).toEqual(before);
  });

  test("F5: per-project on from A → repo file written, B follows without reload, global unchanged", async ({ page }) => {
    setFlag(PROJECT, "unset");
    setFlag(GLOBAL, "false");
    const globalBefore = snapshot(GLOBAL);

    const a = await spawnFreshGitSession(page);
    const b = await spawnFreshGitSession(page);

    await openSessionMenu(page, a);
    await flowMenuItem(page, /turn on edit mode for this project/i).click({ timeout: 60_000 });
    await expect.poll(() => editFlowOf(PROJECT), { timeout: 15_000 }).toBe(true);

    // B: label follows the pushed frame (no reload).
    await closeSessionMenu(page);
    await openSessionMenu(page, b);
    await expect(flowMenuItem(page, /turn off edit mode for this project/i)).toBeVisible({ timeout: 15_000 });
    await expect(flowMenuItem(page, /new \/ edit/i)).toBeVisible();
    expect(snapshot(GLOBAL)).toBe(globalBefore);
  });
});
