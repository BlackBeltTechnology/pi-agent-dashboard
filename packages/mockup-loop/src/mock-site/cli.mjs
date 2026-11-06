#!/usr/bin/env node
// @ts-check
// mock-decide — the agent's accept/reject for live-component mocks: the ONLY
// writer of `decision.json` (`by: "agent"`; the site shows it read-only). Works
// without the site running. See change: add-live-component-mock-site (D4),
// add-mock-site-exact-env (D6).
//   mock-decide list
//   mock-decide accept <ref> [note]
//   mock-decide reject <ref> <note>        (a reason is required)
//   mock-decide reopen <ref>
//   mock-decide adoptable                  (JSON offer for rules.proposal / Step 1b)
//   mock-decide move <mockDir> <changeDir> (adoption: move a live mock dir as one unit)
// <ref> = mock id, any #ref, or a full site URL.
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseRef } from "./refs.mjs";
import { discoverMocks, listAdoptable, moveMockDir } from "./discover.mjs";
import { NOTE_MAX, readDecisions, writeDecision } from "./decisions.mjs";

/** @param {string} d */
const hasManifestKey = (d) => {
  try { return !!JSON.parse(fs.readFileSync(path.join(d, "package.json"), "utf8"))?.mockSite; } catch { return false; }
};
/** A change dir's own `mockups/` is a mock root, never a project root. @param {string} d */
const isChangeDir = (d) => path.basename(path.dirname(path.dirname(d))) === "openspec" && path.basename(path.dirname(d)) === "changes";

/**
 * Project root: nearest ancestor whose `package.json` declares `mockSite`, else the
 * nearest ancestor with a `mockups/` dir, else the git toplevel, else cwd.
 * @param {string} cwd
 */
export function findProjectRoot(cwd) {
  const chain = [];
  for (let d = path.resolve(cwd); ; d = path.dirname(d)) {
    chain.push(d);
    if (path.dirname(d) === d) break;
  }
  const declared = chain.find(hasManifestKey);
  if (declared) return declared;
  const withMocks = chain.find((d) => !isChangeDir(d) && fs.existsSync(path.join(d, "mockups")) && fs.statSync(path.join(d, "mockups")).isDirectory());
  if (withMocks) return withMocks;
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return path.resolve(cwd);
  }
}

/**
 * @param {string[]} argv @param {string} cwd
 * @returns {{ code: number, out: string }}
 */
export function run(argv, cwd = process.cwd()) {
  const [cmd, rawRef, ...rest] = argv;
  const root = findProjectRoot(cwd);
  const usage = "usage: mock-decide list | accept <ref> [note] | reject <ref> <note> | reopen <ref> | adoptable | move <mockDir> <changeDir>";
  if (cmd === "adoptable") return { code: 0, out: JSON.stringify(listAdoptable(root), null, 2) };
  if (cmd === "move") {
    if (!rawRef || !rest[0]) return { code: 2, out: usage };
    const r = moveMockDir(path.resolve(cwd, rawRef), path.resolve(cwd, rest[0]));
    return r.ok ? { code: 0, out: `moved to ${r.dest}` } : { code: 1, out: String(r.error) };
  }
  const { mocks, errors } = discoverMocks(root);
  if (cmd === "list") {
    const { decisions, warnings } = readDecisions(mocks);
    const lines = mocks.map((m) => {
      const d = decisions[m.id];
      return `${(d?.status ?? "open").padEnd(9)}${m.id}${d ? `  by ${d.by}${d.note ? `: ${d.note}` : ""}` : ""}  ${path.relative(root, m.dir)}`;
    });
    return { code: 0, out: [...lines, ...warnings.map((w) => `warning: ${w}`), ...errors.map((e) => `error: ${e}`)].join("\n") || "(no mocks)" };
  }
  if (!["accept", "reject", "reopen"].includes(cmd)) return { code: 2, out: usage };
  if (!rawRef) return { code: 2, out: usage };
  let id;
  try { id = parseRef(rawRef).id; } catch (e) { return { code: 2, out: String(/** @type {Error} */ (e).message) }; }
  const mock = mocks.find((m) => m.id === id);
  if (!mock) return { code: 1, out: `unknown mock id: ${id} (run: mock-decide list)` };
  const note = rest.join(" ").trim();
  if (cmd === "reject" && !note) return { code: 2, out: "reject needs a reason: mock-decide reject <ref> \"why\"" };
  if ([...note].length > NOTE_MAX) return { code: 2, out: `note over ${NOTE_MAX} characters (${[...note].length}); shorten it` };
  const status = cmd === "accept" ? "accepted" : cmd === "reject" ? "rejected" : "open";
  try {
    writeDecision(mock, { status, by: "agent", ...(note ? { note } : {}) });
  } catch (e) {
    return { code: 1, out: `cannot write decision for ${id}: ${String(/** @type {Error} */ (e).message).split("\n")[0]}` };
  }
  return { code: 0, out: `${status} ${id}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const { code, out } = run(process.argv.slice(2));
  (code ? process.stderr : process.stdout).write(out + "\n");
  process.exit(code);
}
