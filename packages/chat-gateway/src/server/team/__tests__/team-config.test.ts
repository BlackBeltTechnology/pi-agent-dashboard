/**
 * Team-controls config validation (change: add-chat-gateway-team-controls).
 * Scenarios: E9 (role→operate rejected), E22 (default retention).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_MIRROR_LEVEL, validateTeamControls } from "../team-config.js";

describe("validateTeamControls", () => {
  it("E9: a role mapped to operate is rejected, naming the reason", () => {
    const result = validateTeamControls({
      bindings: { ws_1: { roles: { role_ops: "operate" } } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("role_cannot_map_to_operate_requires_explicit_identifier");
      expect(result.path).toBe("teamControls.bindings.ws_1.roles.role_ops");
    }
  });

  it("E9b: an identifier mapped to operate is accepted", () => {
    const result = validateTeamControls({
      bindings: { ws_1: { principals: { "123": "operate" } } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.bindings.ws_1.principals["123"]).toBe("operate");
  });

  it("E22: default retention is 10,000 and ceiling defaults to observe", () => {
    const result = validateTeamControls(undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.auditRetention).toBe(10_000);
      expect(result.value.ceiling).toBe("observe");
      expect(result.value.bindings).toEqual({});
    }
  });

  it("normalizes mirror level and per-binding ceiling with fail-closed defaults", () => {
    const result = validateTeamControls({
      ceiling: "control",
      bindings: {
        ws_1: { principals: { a: "control" }, roles: { r: "control" }, mirrorLevel: "full-transcript" },
        ws_2: { principals: { b: "observe" } },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.bindings.ws_1.mirrorLevel).toBe("full-transcript");
      expect(result.value.bindings.ws_2.mirrorLevel).toBe(DEFAULT_MIRROR_LEVEL);
      expect(result.value.bindings.ws_2.ceiling).toBe("control");
    }
  });

  it("rejects a non-integer or out-of-range retention", () => {
    expect(validateTeamControls({ auditRetention: 0 }).ok).toBe(false);
    expect(validateTeamControls({ auditRetention: 1.5 }).ok).toBe(false);
    expect(validateTeamControls({ auditRetention: "many" }).ok).toBe(false);
  });
});

describe("validateTeamControls — provisioning guild", () => {
  it("accepts an absent guildId (the layer then reports it cannot provision)", () => {
    const result = validateTeamControls({ bindings: { ws_1: {} } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.guildId).toBeUndefined();
  });

  it("accepts and trims a guildId", () => {
    const result = validateTeamControls({ guildId: " 123456789 " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.guildId).toBe("123456789");
  });

  it("rejects a blank or non-string guildId", () => {
    for (const guildId of ["", "   ", 42, {}, []]) {
      const result = validateTeamControls({ guildId });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("invalid_guild_id");
        expect(result.path).toBe("teamControls.guildId");
      }
    }
  });
});
