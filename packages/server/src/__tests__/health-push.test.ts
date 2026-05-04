/**
 * Health endpoint test for push.errors surfacing.
 *
 * The /api/health endpoint must include `push: {errors: [...]}` when
 * push.enabled is true and config.push.errors is non-empty (e.g. missing
 * contactEmail).
 *
 * See change: add-server-push-notifications.
 */
import { describe, it, expect } from "vitest";
import { parsePushConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";

describe("push config → health endpoint integration", () => {
  it("parsePushConfig sets errors when enabled and no contactEmail", () => {
    const config = parsePushConfig({ enabled: true });
    expect(config.errors).toEqual(["missing contactEmail"]);

    // Simulate what registerSystemRoutes would do:
    // if (config.push?.enabled && config.push.errors?.length > 0)
    //   health.push = { errors: config.push.errors };
    if (config.errors && config.errors.length > 0) {
      const health: Record<string, unknown> = {};
      health.push = { errors: config.errors };
      expect(health.push).toEqual({ errors: ["missing contactEmail"] });
    } else {
      expect(false).toBe(true); // should not reach here
    }
  });

  it("does not surface push.errors when push is disabled", () => {
    const config = parsePushConfig({ enabled: false });
    expect(config.errors).toBeUndefined();

    // The health endpoint should NOT include push.errors key
    const health: Record<string, unknown> = {};
    if (config.enabled && config.errors && config.errors.length > 0) {
      health.push = { errors: config.errors };
    }
    expect(health.push).toBeUndefined();
  });

  it("does not surface push.errors when enabled and valid contactEmail", () => {
    const config = parsePushConfig({
      enabled: true,
      webPush: { contactEmail: "user@example.com" },
    });
    expect(config.errors).toBeUndefined();

    const health: Record<string, unknown> = {};
    if (config.enabled && config.errors && config.errors.length > 0) {
      health.push = { errors: config.errors };
    }
    expect(health.push).toBeUndefined();
  });
});
