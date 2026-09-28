/**
 * Tests for `sendPiVersionIfChanged` — bridge-side pi-version reporting.
 * See change: restore-pi-version-skew-surface.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  sendPiVersionIfChanged,
  _resetPiVersionCache,
  readPkgVersionByWalkUp,
  readRunningPiVersion,
} from "../model-tracker.js";
import type { BridgeContext } from "../bridge-context.js";

function makeBc() {
  const send = vi.fn();
  const bc = { sessionId: "sess-1", connection: { send } } as unknown as BridgeContext;
  return { bc, send };
}

describe("sendPiVersionIfChanged", () => {
  beforeEach(() => _resetPiVersionCache());

  it("pushes once on first read", () => {
    const { bc, send } = makeBc();
    sendPiVersionIfChanged(bc, () => "0.80.2");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: "pi_version_update", sessionId: "sess-1", version: "0.80.2" });
  });

  it("does not push when the version is unchanged", () => {
    const { bc, send } = makeBc();
    sendPiVersionIfChanged(bc, () => "0.80.2");
    sendPiVersionIfChanged(bc, () => "0.80.2");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("pushes again when the version changes (out-of-band upgrade)", () => {
    const { bc, send } = makeBc();
    sendPiVersionIfChanged(bc, () => "0.80.2");
    sendPiVersionIfChanged(bc, () => "0.81.0");
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith({ type: "pi_version_update", sessionId: "sess-1", version: "0.81.0" });
  });

  it("read failure: no crash, no push, warns", () => {
    const { bc, send } = makeBc();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => sendPiVersionIfChanged(bc, () => { throw new Error("boom"); })).not.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("undefined version: no push", () => {
    const { bc, send } = makeBc();
    sendPiVersionIfChanged(bc, () => undefined);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("readPkgVersionByWalkUp", () => {
  const PKG = "@earendil-works/pi-coding-agent";

  // Simulate a restrictive-exports install: resolve(".") lands on dist/index.js,
  // and package.json (omitting the ./package.json subpath) sits one level up.
  it("reads version by walking up when ./package.json subpath is not exported", () => {
    const root = "/node_modules/@earendil-works/pi-coding-agent";
    const entry = `${root}/dist/index.js`;
    const files: Record<string, string> = {
      [`${root}/package.json`]: JSON.stringify({ name: PKG, version: "0.80.2" }),
    };
    const v = readPkgVersionByWalkUp(
      PKG,
      () => entry,
      (p) => {
        const f = files[p];
        if (f === undefined) throw new Error(`ENOENT ${p}`);
        return f;
      },
      (p) => p in files,
    );
    expect(v).toBe("0.80.2");
  });

  it("skips a non-matching ancestor package.json (workspace root)", () => {
    const root = "/repo/node_modules/@earendil-works/pi-coding-agent";
    const entry = `${root}/dist/index.js`;
    const files: Record<string, string> = {
      "/repo/package.json": JSON.stringify({ name: "the-workspace", version: "9.9.9" }),
      [`${root}/package.json`]: JSON.stringify({ name: PKG, version: "0.80.2" }),
    };
    const v = readPkgVersionByWalkUp(
      PKG,
      () => entry,
      (p) => files[p] ?? (() => { throw new Error(`ENOENT ${p}`); })(),
      (p) => p in files,
    );
    expect(v).toBe("0.80.2");
  });

  it("returns undefined (no throw) when no matching manifest is found", () => {
    const v = readPkgVersionByWalkUp(
      PKG,
      () => "/nowhere/dist/index.js",
      () => { throw new Error("should not read"); },
      () => false,
    );
    expect(v).toBeUndefined();
  });
});

/**
 * `readRunningPiVersion` — the argv-anchored reader that gates slash-command
 * dispatch. See change: retire-slash-dispatch-via-expand-prompt-templates
 * (design D3; test-plan E8, E9, E10-half).
 */
describe("readRunningPiVersion", () => {
  /** A fake filesystem keyed by absolute path. */
  function fsStub(files: Record<string, string>) {
    return {
      readFile: (p: string) => {
        const f = files[p];
        if (f === undefined) throw new Error(`ENOENT ${p}`);
        return f;
      },
      fileExists: (p: string) => p in files,
    };
  }

  it("E1 (symlinked install): a bin-symlink argv[1] is realpath-ed before the walk-up", () => {
    // `node_modules/.bin/pi` and `/usr/local/bin/pi` are SYMLINKS to the package
    // entry, and Node does NOT realpath `argv[1]`. Without resolution the walk-up
    // starts in `.bin/`, finds no pi manifest within the depth bound, and answers
    // `undefined` — so the gate would "assume new" and an OLD pi would receive
    // the raw slash as a model turn.
    const root = "/repo/node_modules/@earendil-works/pi-coding-agent";
    const resolved: string[] = [];
    const v = readRunningPiVersion("/repo/node_modules/.bin/pi", {
      realpath: (p) => {
        resolved.push(p);
        return `${root}/dist/bundle/cli.js`;
      },
      ...fsStub({
        [`${root}/package.json`]: JSON.stringify({
          name: "@earendil-works/pi-coding-agent",
          version: "0.84.1",
        }),
      }),
    });
    expect(resolved).toEqual(["/repo/node_modules/.bin/pi"]);
    expect(v).toBe("0.84.1");
  });

  it("a failing realpath falls back to the literal argv[1] (no throw)", () => {
    const root = "/x/node_modules/@mariozechner/pi-coding-agent";
    const v = readRunningPiVersion(`${root}/dist/cli.js`, {
      realpath: () => {
        throw new Error("ENOENT");
      },
      ...fsStub({
        [`${root}/package.json`]: JSON.stringify({
          name: "@mariozechner/pi-coding-agent",
          version: "0.73.1",
        }),
      }),
    });
    expect(v).toBe("0.73.1");
  });

  it("E8: reads the @mariozechner build the process actually runs inside", () => {
    const root = "/x/node_modules/@mariozechner/pi-coding-agent";
    const v = readRunningPiVersion(
      `${root}/dist/cli.js`,
      fsStub({
        [`${root}/package.json`]: JSON.stringify({
          name: "@mariozechner/pi-coding-agent",
          version: "0.73.1",
        }),
      }),
    );
    expect(v).toBe("0.73.1");
  });

  it("E9: argv anchor wins over a hoisted newer by-name copy", () => {
    // The hoisted earendil copy a by-name resolver would find is NEWER (0.85.1)
    // than the copy the process runs inside (0.80.10). Reading the hoisted copy
    // would wave the command through on a pi that cannot honor
    // `expandPromptTemplates` — exactly the silent-regression this reader
    // closes. Both manifests are on the fake fs; only the argv walk is read.
    const running = "/user/local/node_modules/@earendil-works/pi-coding-agent";
    const hoisted = "/repo/node_modules/@earendil-works/pi-coding-agent";
    const v = readRunningPiVersion(
      `${running}/dist/bundle/cli.js`,
      fsStub({
        [`${running}/package.json`]: JSON.stringify({
          name: "@earendil-works/pi-coding-agent",
          version: "0.80.10",
        }),
        [`${hoisted}/package.json`]: JSON.stringify({
          name: "@earendil-works/pi-coding-agent",
          version: "0.85.1",
        }),
      }),
    );
    expect(v).toBe("0.80.10");
  });

  it("E10 half: no matching manifest on the walk-up → undefined, no throw", () => {
    const v = readRunningPiVersion(
      "/nowhere/dist/cli.js",
      fsStub({ "/nowhere/package.json": JSON.stringify({ name: "something-else", version: "1.0.0" }) }),
    );
    expect(v).toBeUndefined();
  });

  it("missing argv[1] → undefined, no throw", () => {
    expect(readRunningPiVersion(undefined, fsStub({}))).toBeUndefined();
  });

  it("an unreadable manifest → undefined, no throw", () => {
    const v = readRunningPiVersion("/x/dist/cli.js", {
      readFile: () => {
        throw new Error("EACCES");
      },
      fileExists: () => true,
    });
    expect(v).toBeUndefined();
  });
});

/**
 * pi 0.84.x audit records. These are NOT feature tests — they pin the evidence
 * behind three "audited, not applicable" findings so a future pi release that
 * invalidates the analysis fails loudly instead of silently rotting.
 *
 * See change: update-pi-core-0-84-adopt-apis (test-plan #E7, #E8, #E17).
 */
describe("pi 0.84.x audit records", () => {
  // Resolve the pinned/recommended runtime the SERVER depends on, not the
  // hoisted copy other workspace packages share via their broad >=0.80.10
  // ranges. Those are deliberately allowed to lag; this assertion is about the
  // version the dashboard actually runs.
  const repoRoot = path.resolve(__dirname, "../../../..");
  const pinnedPiDir = path.join(
    repoRoot,
    "packages/server/node_modules/@earendil-works/pi-coding-agent",
  );
  const hoistedPiDir = path.join(repoRoot, "node_modules/@earendil-works/pi-coding-agent");
  const piDir = fs.existsSync(pinnedPiDir) ? pinnedPiDir : hoistedPiDir;

  it("E7 guard: the copy under audit is the pinned recommended runtime", () => {
    // Without this, E7 could silently pass by reading the hoisted 0.83.0 copy
    // and would assert nothing about the version the dashboard actually runs.
    const recommended = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "packages/server/package.json"), "utf-8"),
    ).piCompatibility.recommended;
    const audited = JSON.parse(fs.readFileSync(path.join(piDir, "package.json"), "utf-8")).version;
    expect(audited, `audited pi copy at ${piDir}`).toBe(recommended);
  });

  it("E7: the in-process MessageUpdateEvent still carries the cumulative message", () => {
    // pi#7290 removed `message` from message_update on the JSON/RPC *stdout*
    // surface only. The in-process ExtensionAPI surface — the one the bridge
    // consumes — kept it. If this assertion ever fails, the delta-accumulation
    // work this change deliberately skipped has become necessary.
    const types = fs.readFileSync(
      path.join(piDir, "dist/core/extensions/types.d.ts"),
      "utf-8",
    );
    const iface = types.match(/export interface MessageUpdateEvent \{[^}]*\}/);
    expect(iface, "MessageUpdateEvent not found in the in-process types").toBeTruthy();
    expect(iface![0]).toMatch(/\bmessage:\s*AgentMessage\b/);
    expect(iface![0]).toMatch(/\bassistantMessageEvent:\s*AssistantMessageEvent\b/);
  });

  it("E8: the bridge consumes the in-process surface, never pi's stdout stream", () => {
    const bridge = fs.readFileSync(path.join(__dirname, "../bridge.ts"), "utf-8");
    expect(bridge).toMatch(/pi\.on\(/);
    // The JSON/RPC stdout event surface must not leak into the bridge.
    expect(bridge).not.toMatch(/toJsonEvent/);
    expect(bridge).not.toMatch(/JsonAgentSessionEvent/);
  });

  it("E17: the admission handler blocks but never sets `terminate`", () => {
    // `ToolCallEventResult.terminate` only takes effect for a handler that
    // returns `block`. The bridge's pass-through `tool_call` forwarder does not
    // block; the ONLY blocking handler is subagent fan-out admission
    // (bound-subagent-fanout-under-host-pressure), which returns `block` +
    // `reason` and deliberately never sets `terminate` — a refusal is "not now".
    // This revisits the pi-api-feature-detection requirement that recorded the
    // field as not-applicable while the bridge never blocked.
    const bridge = fs.readFileSync(path.join(__dirname, "../bridge.ts"), "utf-8");
    const passThrough = bridge.match(/const passThroughEventTypes = \[([\s\S]*?)\] as const;/);
    expect(passThrough, "passThroughEventTypes block not found").toBeTruthy();
    expect(passThrough![1]).toMatch(/"tool_call"/);
    // The bridge source itself must not inline a block/terminate result.
    expect(bridge).not.toMatch(/terminate:\s*true/);
    expect(bridge).not.toMatch(/block:\s*true/);

    const admission = fs.readFileSync(
      path.join(__dirname, "../subagent-fanout-admission.ts"),
      "utf-8",
    );
    expect(admission).toMatch(/block:\s*true/);
    expect(admission).not.toMatch(/terminate:\s*true/);
  });
});
