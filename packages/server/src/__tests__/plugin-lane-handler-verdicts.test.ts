/**
 * Guard: every first-party `registerPiRequestHandler` call site carries an explicit verdict
 * (hub-local-only | deferred with a reason | none), so a new lane handler cannot be forgotten.
 * A handler that returns a credential, secret or path-trusted value MUST pass `{ hubLocalOnly: true }`
 * (the host refuses it with `origin_denied` for a remote-origin or deprecated-admission session).
 *
 * When `add-web-chat-plugin` lands, its lane handlers serve isolated spawn sessions whose spawn-scoped
 * admission is absent from `isLocallyAdmitted`: they get an explicit non-hub-local-only row here,
 * never a silent `hubLocalOnly` that would deny them.
 * See change: harden-bridge-session-claim (task 3.6).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGES = path.resolve(__dirname, "../../..");

type Verdict = { kind: "hub-local-only" } | { kind: "deferred"; reason: string } | { kind: "none"; reason: string };

/** `<file relative to packages/>` -> verdict per registration key (the message-type constant or literal). */
const VERDICTS: Record<string, Record<string, Verdict>> = {
  "gmail-plugin/src/server/index.ts": {
    LEASE_TYPE: { kind: "hub-local-only" },
    ACCOUNTS_TYPE: { kind: "hub-local-only" },
  },
  "google-plugin/src/server/index.ts": {
    LEASE_TYPE: { kind: "hub-local-only" },
    ACCOUNTS_TYPE: { kind: "hub-local-only" },
  },
  "flows-plugin/src/server/flow-files.ts": {
    FLOW_FILES_REPORT: { kind: "hub-local-only" },
  },
  // Agent `flow_open`: admits paths on the hub's disk. See change: add-flow-open-tool.
  "flows-plugin/src/server/flow-open.ts": {
    FLOW_OPEN_REQUEST: { kind: "hub-local-only" },
  },
  "browser-plugin/src/server/index.ts": {
    '"browser/open"': { kind: "deferred", reason: "WS-05b: drives the hub relay browser; no stored secret" },
    '"browser/connect"': { kind: "deferred", reason: "WS-05b: same" },
    '"browser/await-state"': { kind: "deferred", reason: "WS-05b: same" },
  },
  "craft-web-plugin/src/server/index.ts": {
    CONTROL_REQUEST: { kind: "deferred", reason: "WS-05b: drives a Craft editor by hub path; no stored secret" },
  },
  // Teammate/lead lane: caller identity is the lane socket session id, every handler is hub-local.
  // See change: add-agent-teams-core (D3).
  "agent-teams-plugin/src/server/lane.ts": {
    type: { kind: "hub-local-only" },
  },
  "demo-plugin/src/server/index.ts": {
    DEMO_ECHO_TYPE: { kind: "none", reason: "echo" },
  },
};

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "__tests__" || e.name === "dist") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) yield p;
  }
}

/** `[file, key, argsText]` for every `registerPiRequestHandler?.(` / `registerPiRequestHandler(` CALL. */
function registrations(): Array<{ file: string; key: string; text: string }> {
  const out: Array<{ file: string; key: string; text: string }> = [];
  for (const pkg of fs.readdirSync(PACKAGES)) {
    if (!pkg.endsWith("-plugin")) continue;
    const server = path.join(PACKAGES, pkg, "src", "server");
    if (!fs.existsSync(server)) continue;
    for (const file of walk(server)) {
      const src = fs.readFileSync(file, "utf8");
      const re = /registerPiRequestHandler\??\.?\(\s*([^,\s]+)/g;
      for (let m = re.exec(src); m; m = re.exec(src)) {
        // Skip prose in comments (`registerPiRequestHandler(messageType, …)`).
        const lineStart = src.lastIndexOf("\n", m.index) + 1;
        if (/^\s*(\*|\/\/)/.test(src.slice(lineStart, m.index + 5))) continue;
        out.push({ file: path.relative(PACKAGES, file), key: m[1], text: src.slice(m.index, m.index + 600) });
      }
    }
  }
  return out;
}

/**
 * @structural-pin enumerates `registerPiRequestHandler` call sites in plugin source: a handler registered without an explicit verdict row has no runtime signal.
 */
describe("first-party plugin lane handlers each have an explicit verdict", () => {
  const found = registrations();

  it("finds the known registrations (the scan itself works)", () => {
    expect(found.length).toBeGreaterThanOrEqual(8);
  });

  it("every registration has a verdict row, and every verdict row is still registered", () => {
    const unlisted = found.filter((r) => !VERDICTS[r.file]?.[r.key]).map((r) => `${r.file}: ${r.key}`);
    expect(unlisted, "add an explicit verdict row for each new lane handler").toEqual([]);
    for (const [file, rows] of Object.entries(VERDICTS)) {
      for (const key of Object.keys(rows)) {
        expect(found.some((r) => r.file === file && r.key === key), `stale verdict row ${file}: ${key}`).toBe(true);
      }
    }
  });

  it("a hub-local-only verdict is backed by `hubLocalOnly: true` at the registration", () => {
    for (const r of found) {
      const v = VERDICTS[r.file]?.[r.key];
      if (v?.kind !== "hub-local-only") continue;
      // flows passes the option after the handler body; gmail inline. Search forward in the file.
      const src = fs.readFileSync(path.join(PACKAGES, r.file), "utf8");
      const from = src.indexOf(r.text.slice(0, 60));
      expect(src.slice(from, from + 1500), `${r.file}: ${r.key}`).toMatch(/hubLocalOnly:\s*true/);
    }
  });
});
