/**
 * Team-controls config validation (change: add-chat-gateway-team-controls).
 * Scenarios: E9 (role→operate rejected), E22 (default retention).
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MIRROR_LEVEL,
  MAX_BINDINGS,
  MAX_MAPPINGS_PER_BINDING,
  validateTeamControls,
  validateTeamControlsWrite,
} from "../team-config.js";

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

// ── Hardening (task 9.3 security pass) ────────────────────────────────────

describe("validateTeamControlsWrite — a live write cannot mean 'reset'", () => {
  it("REFUSES an absent payload instead of defaulting to an empty config", () => {
    // The startup path reads `undefined` as "nothing configured yet" and must
    // default. A live write must not: applying it as defaults would wipe every
    // binding and deactivate every provisioned channel.
    const result = validateTeamControlsWrite(undefined);
    expect(result).toMatchObject({
      ok: false,
      reason: "team_controls_payload_required",
      path: "teamControls",
    });
  });

  it("refuses null, an array and a scalar", () => {
    for (const bad of [null, [], "observe", 7, true]) {
      expect(validateTeamControlsWrite(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("accepts an explicit empty object — that IS a deliberate reset", () => {
    const result = validateTeamControlsWrite({});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.bindings).toEqual({});
  });

  it("still applies the full validation to a well-formed payload", () => {
    const result = validateTeamControlsWrite({
      bindings: { ws_1: { roles: { r_ops: "operate" } } },
    });
    expect(result).toMatchObject({ ok: false, reason: "role_cannot_map_to_operate_requires_explicit_identifier" });
  });

  it("keeps the startup default behaviour unchanged", () => {
    const result = validateTeamControls(undefined);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.ceiling).toBe("observe");
  });
});

describe("prototype-safe keys", () => {
  it("rejects a reserved workspace id rather than letting it reassign a prototype", () => {
    // MUST come through JSON.parse: in an object LITERAL, `__proto__` sets the
    // prototype and never becomes an own key, so only a parsed payload can
    // carry one. That parsed form is exactly what arrives over the wire.
    const viaJson = JSON.parse('{"bindings":{"__proto__":{"principals":{}}}}');
    expect(Object.hasOwn(viaJson.bindings, "__proto__")).toBe(true);
    expect(validateTeamControls(viaJson)).toMatchObject({
      ok: false,
      reason: "reserved_workspace_id",
    });
  });

  it("would otherwise lose the binding and pollute lookups", () => {
    // Demonstrates the hazard the guard prevents, so the guard is not vacuous.
    const hazard: Record<string, unknown> = {};
    const parsed = JSON.parse('{"bindings":{"__proto__":{"polluted":true}}}');
    hazard.__proto__ = parsed.bindings.__proto__;
    expect(Object.keys(hazard)).toEqual([]);
    expect((hazard as { polluted?: boolean }).polluted).toBe(true);
  });

  it("rejects reserved principal and role ids", () => {
    const asPrincipal = validateTeamControls(
      JSON.parse('{"bindings":{"ws_1":{"principals":{"constructor":"control"}}}}'),
    );
    expect(asPrincipal).toMatchObject({ ok: false, reason: "reserved_principal_id" });
    const asRole = validateTeamControls(
      JSON.parse('{"bindings":{"ws_1":{"roles":{"prototype":"control"}}}}'),
    );
    expect(asRole).toMatchObject({ ok: false, reason: "reserved_role_id" });
  });

  it("builds a bindings map with a null prototype's worth of safety", () => {
    const result = validateTeamControls({ bindings: { ws_1: { principals: { u_1: "observe" } } } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value.bindings)).toEqual(["ws_1"]);
    expect(result.value.bindings.ws_1.principals).toEqual({ u_1: "observe" });
  });
});

describe("cardinality bounds", () => {
  it("refuses more bindings than the cap", () => {
    const bindings: Record<string, unknown> = {};
    for (let i = 0; i <= MAX_BINDINGS; i++) bindings[`ws_${i}`] = { principals: {} };
    expect(validateTeamControls({ bindings })).toMatchObject({
      ok: false,
      reason: "too_many_bindings",
    });
  });

  it("refuses more mappings than the cap, for principals and roles alike", () => {
    const many = (n: number, tier: string) =>
      Object.fromEntries(Array.from({ length: n + 1 }, (_, i) => [`u_${i}`, tier]));
    const principals = validateTeamControls({
      bindings: { ws_1: { principals: many(MAX_MAPPINGS_PER_BINDING, "observe") } },
    });
    expect(principals).toMatchObject({ ok: false, reason: "too_many_principals" });
    const roles = validateTeamControls({
      bindings: { ws_1: { roles: many(MAX_MAPPINGS_PER_BINDING, "control") } },
    });
    expect(roles).toMatchObject({ ok: false, reason: "too_many_roles" });
  });

  it("accepts a config at exactly the cap", () => {
    const bindings: Record<string, unknown> = {};
    for (let i = 0; i < MAX_BINDINGS; i++) bindings[`ws_${i}`] = { principals: {} };
    expect(validateTeamControls({ bindings }).ok).toBe(true);
  });
});

describe("the global ceiling is a HARD maximum (9.4 doubt-driven review)", () => {
  it("does not let a binding raise the ceiling above the global one", () => {
    // The schema says "maximum tier any principal MAY RESOLVE TO". If a binding
    // could raise it, an operator choosing the safest global `observe` would be
    // silently defeated by one binding's stale `operate`.
    const result = validateTeamControls({
      ceiling: "observe",
      bindings: { ws_1: { ceiling: "operate" } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.bindings.ws_1.ceiling).toBe("observe");
  });

  it("lets a binding narrow itself below the global ceiling", () => {
    const result = validateTeamControls({
      ceiling: "operate",
      bindings: { ws_1: { ceiling: "control" }, ws_2: {} },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.bindings.ws_1.ceiling).toBe("control");
      // An unset binding ceiling still inherits the global one.
      expect(result.value.bindings.ws_2.ceiling).toBe("operate");
    }
  });

  it("caps the effective ceiling at observe when the global ceiling is observe", () => {
    const result = validateTeamControls({
      ceiling: "observe",
      bindings: {
        ws_1: { ceiling: "operate", principals: { u_1: "operate" }, roles: { r_1: "control" } },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.bindings.ws_1.ceiling).toBe("observe");
  });

  it("is not vacuous: the clamp is the GLOBAL value, not a constant", () => {
    // Same binding ceiling, two different globals ⇒ two different results.
    const underControl = validateTeamControls({
      ceiling: "control",
      bindings: { ws_1: { ceiling: "operate" } },
    });
    const underOperate = validateTeamControls({
      ceiling: "operate",
      bindings: { ws_1: { ceiling: "operate" } },
    });
    expect(underControl.ok && underOperate.ok).toBe(true);
    if (underControl.ok && underOperate.ok) {
      expect(underControl.value.bindings.ws_1.ceiling).toBe("control");
      expect(underOperate.value.bindings.ws_1.ceiling).toBe("operate");
    }
  });
});
