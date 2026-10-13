/**
 * ACP agent env: redacted on read, preserved on write.
 * See change: add-acp-session-driver (test-plan #E19).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readConfigRedacted, writeConfigPartial } from "../config-api.js";

let home: string;
let origHome: string;
let file: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "acp-redact-"));
  fs.mkdirSync(path.join(home, ".pi", "dashboard"), { recursive: true });
  file = path.join(home, ".pi", "dashboard", "config.json");
  origHome = process.env.HOME as string;
  process.env.HOME = home;
  fs.writeFileSync(
    file,
    JSON.stringify({
      acpAgents: [
        { id: "qmt", name: "querymt", command: "qmtcode", env: { OPENAI_API_KEY: "sk-x" } },
        { id: "other", name: "o", command: "o", env: { OPENAI_API_KEY: "sk-other" } },
      ],
    }),
  );
});

afterEach(() => {
  process.env.HOME = origHome;
  fs.rmSync(home, { recursive: true, force: true });
});

const onDisk = () => JSON.parse(fs.readFileSync(file, "utf-8")).acpAgents as Array<{ id: string; env: Record<string, string> }>;

describe("config-api: acpAgents env", () => {
  it("E19: GET body lacks the secret; saving it back unchanged keeps the stored value", () => {
    const redacted = readConfigRedacted();
    expect(JSON.stringify(redacted)).not.toContain("sk-x");
    expect(JSON.stringify(redacted)).not.toContain("sk-other");
    expect(redacted.acpAgents[0]?.env).toEqual({ OPENAI_API_KEY: "***" });

    const res = writeConfigPartial({ acpAgents: redacted.acpAgents });
    expect(res.success).toBe(true);
    expect(onDisk().find((a) => a.id === "qmt")?.env.OPENAI_API_KEY).toBe("sk-x");
    expect(onDisk().find((a) => a.id === "other")?.env.OPENAI_API_KEY).toBe("sk-other");
  });

  it("E19: a non-*** value is written; preservation matches by agent id + key", () => {
    writeConfigPartial({
      acpAgents: [
        { id: "qmt", name: "querymt", command: "qmtcode", env: { OPENAI_API_KEY: "sk-new", EXTRA: "***" } },
        { id: "other", name: "o", command: "o", env: { OPENAI_API_KEY: "***" } },
      ],
    });
    const qmt = onDisk().find((a) => a.id === "qmt");
    expect(qmt?.env.OPENAI_API_KEY).toBe("sk-new");
    expect(qmt?.env).not.toHaveProperty("EXTRA"); // no stored value to preserve → dropped, never written as "***"
    expect(onDisk().find((a) => a.id === "other")?.env.OPENAI_API_KEY).toBe("sk-other");
  });
});
