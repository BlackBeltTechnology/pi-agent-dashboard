/**
 * S3 — denylisted verb excluded from the generated helpers.
 * Triple: plugin_config_write union member · run codegen · no WS helper emitted
 * for it (test-plan #S3).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GENERATED_VERBS } from "../generated/verbs.js";
import { CLIENT_INTERCEPTED_DENYLIST } from "../denylist.js";
import { enumerateUnion } from "../codegen/generate-verbs.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..");
const PROTOCOL = path.join(REPO_ROOT, "packages/shared/src/browser-protocol.ts");

describe("codegen denylist (S3)", () => {
  it("plugin_config_write is a real union member but is NOT generated", () => {
    const rawVerbs = enumerateUnion(PROTOCOL, "BrowserToServerMessage").map((v) => v.verb);
    // It exists in the raw protocol union …
    expect(rawVerbs).toContain("plugin_config_write");
    // … and it is on the denylist …
    expect(CLIENT_INTERCEPTED_DENYLIST).toContain("plugin_config_write");
    // … so codegen must exclude it (no naive WS helper that would silently fail).
    expect(GENERATED_VERBS).not.toContain("plugin_config_write");
  });

  it("every denylist member is excluded from the generated verbs", () => {
    for (const denied of CLIENT_INTERCEPTED_DENYLIST) {
      expect(GENERATED_VERBS).not.toContain(denied);
    }
  });
});
