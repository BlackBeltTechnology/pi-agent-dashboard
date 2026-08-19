/**
 * /create + /update reject an unknown `action.kind` BEFORE writing files,
 * mirroring the read-path validation so a client cannot persist a config
 * that /list would later mark invalid. Registered ids + built-in aliases
 * pass. See change: register-plugin-automation-events.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { mountAutomationRoutes } from "../server/routes.js";
import type { AutomationConfig } from "../shared/automation-types.js";

const actionIds = () => new Set(["core.prompt", "core.skill", "flows.run"]);

function configWith(kind: string): AutomationConfig {
  return {
    on: { kind: "schedule", cron: "0 9 * * *" },
    action: kind === "flows.run" ? { kind, payload: { flow: "test:x" } } : { kind },
    model: "@fast",
    mode: "worktree",
    sandbox: "workspace-write",
    concurrency: "skip",
  } as AutomationConfig;
}

async function appWith() {
  const app = Fastify();
  mountAutomationRoutes(app, { actionIds });
  await app.ready();
  return app;
}

let tmp: string;
afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe("action.kind validation on write", () => {
  for (const url of ["/api/plugins/automation/create", "/api/plugins/automation/update"]) {
    it(`400 for an unknown action kind (${url})`, async () => {
      const app = await appWith();
      const res = await app.inject({
        method: "POST",
        url,
        payload: { scope: "folder", cwd: "/repo", name: "a", config: configWith("bogus.kind") },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("bogus.kind");
      await app.close();
    });
  }

  it("allows a registered plugin action id (writes to disk)", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "routes-kind-"));
    const app = await appWith();
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/automation/create",
      payload: { scope: "folder", cwd: tmp, name: "nightly", config: configWith("flows.run") },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    await app.close();
  });

  it("allows the built-in `skill` alias", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "routes-kind-"));
    const app = await appWith();
    const cfg = configWith("skill");
    cfg.action = { kind: "skill", skill: "$x" };
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/automation/create",
      payload: { scope: "folder", cwd: tmp, name: "sk", config: cfg },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  // E24 — see change: add-automation-concurrent-spawn.
  for (const url of ["/api/plugins/automation/create", "/api/plugins/automation/update"]) {
    it(`400 for an unknown \`actions:\` entry naming the index (${url})`, async () => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "routes-kind-"));
      const app = await appWith();
      const config = {
        on: { kind: "schedule", cron: "0 9 * * *" },
        actions: [{ kind: "flows.run", payload: { flow: "x" } }, { kind: "bogus.kind" }],
        model: "@fast",
        mode: "worktree",
        sandbox: "workspace-write",
        concurrency: "skip",
      } as unknown as AutomationConfig;
      const res = await app.inject({ method: "POST", url, payload: { scope: "folder", cwd: tmp, name: "fan", config } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("actions[1]");
      // Nothing persisted that /list would later mark invalid.
      expect(fs.existsSync(path.join(tmp, ".pi", "automation", "fan", "automation.yaml"))).toBe(false);
      await app.close();
    });
  }

  // E25 — see change: add-automation-concurrent-spawn.
  it("/create succeeds for an `actions:`-only config (no `action:` block)", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "routes-kind-"));
    const app = await appWith();
    const config = {
      on: { kind: "schedule", cron: "0 9 * * *" },
      actions: [{ kind: "flows.run", payload: { flow: "a" } }, { kind: "core.skill", payload: { skill: "b" } }],
      model: "@fast",
      mode: "worktree",
      sandbox: "workspace-write",
      concurrency: "skip",
    } as unknown as AutomationConfig;
    const res = await app.inject({ method: "POST", url: "/api/plugins/automation/create", payload: { scope: "folder", cwd: tmp, name: "fanonly", config } });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    await app.close();
  });

  it("/update allows a registered plugin action id (writes in place)", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "routes-kind-"));
    const app = await appWith();
    // seed it first, then update in place
    await app.inject({
      method: "POST",
      url: "/api/plugins/automation/create",
      payload: { scope: "folder", cwd: tmp, name: "nightly", config: configWith("flows.run") },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/automation/update",
      payload: { scope: "folder", cwd: tmp, name: "nightly", config: configWith("flows.run") },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    await app.close();
  });
});
