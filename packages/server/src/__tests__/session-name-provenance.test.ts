/**
 * Pure provenance lattice (`auto | system | user`), bridge-claim guard and the
 * register-time restore projection. See change: investigate-auto-name-provenance-relabel
 * (test-plan #E10 #E11 #E12 #E13 #E14 #E17 #X6).
 */
import { describe, expect, it } from "vitest";
import { detachShouldClearName } from "../openspec/proposal-attach-naming.js";
import {
  buildAutoNameRestore,
  guardBridgeNameClaim,
  systemRenameUpdates,
  userRenameUpdates,
} from "../session/name-provenance.js";

type Src = "auto" | "system" | "user" | undefined;
const sess = (nameSource: Src, nameSourceFor?: string) => ({ nameSource, nameSourceFor });

describe("E10: guardBridgeNameClaim table", () => {
  it.each<[Src, "W" | undefined]>([[undefined, undefined], ["auto", "W"], ["system", "W"], ["user", undefined]])(
    "provenance=%j witness=%j",
    (cur, wit) => {
      const s = sess(cur, wit);
      // user claim on the witness
      const onWitness = guardBridgeNameClaim(s, "W", "user");
      const onWitnessNl = guardBridgeNameClaim(s, "W\n", "user");
      if (cur === "auto" || cur === "system") {
        expect(onWitness).toEqual({ name: "W" }); // provenance kept
        expect(onWitnessNl).toEqual({ name: "W\n" });
      } else {
        expect(onWitness).toMatchObject({ nameSource: "user", nameSourceFor: undefined });
      }
      // user claim on a different name → user + witness cleared
      expect(guardBridgeNameClaim(s, "X", "user")).toEqual({ name: "X", nameSource: "user", nameSourceFor: undefined });
      // auto claim
      const auto = guardBridgeNameClaim(s, "T", "auto");
      if (cur === "system" || cur === "user") expect(auto).toBeUndefined();
      else expect(auto).toEqual({ name: "T", nameSource: "auto", nameSourceFor: "T" });
      // unattributed poll: name applied, provenance + witness untouched
      expect(guardBridgeNameClaim(s, "X", undefined)).toEqual({ name: "X" });
    },
  );
});

describe("E11 / X6: the witness survives a plain name and the old-bridge echo", () => {
  it("plain name then a user claim for the same name keeps `auto` + witness", () => {
    const s = sess("auto", "Fix login");
    expect(guardBridgeNameClaim(s, "Fix login", undefined)).toEqual({ name: "Fix login" });
    expect(guardBridgeNameClaim(s, "Fix login", "user")).toEqual({ name: "Fix login" });
  });
  it("X6: old-bridge user claim on the system witness keeps system", () => {
    expect(guardBridgeNameClaim(sess("system", "add-x"), "add-x", "user")).toEqual({ name: "add-x" });
  });
});

describe("E12: system renames", () => {
  it("unnamed → system + witness", () => {
    expect(systemRenameUpdates(undefined, "add-x")).toEqual({ name: "add-x", nameSource: "system", nameSourceFor: "add-x" });
    expect(systemRenameUpdates({ nameSource: "auto" }, "add-x")).toMatchObject({ nameSource: "system", nameSourceFor: "add-x" });
  });
  it("user stays user (name may change, no provenance fields)", () => {
    const u = systemRenameUpdates({ nameSource: "user" }, "add-x");
    expect(u).toEqual({ name: "add-x" });
    expect(u).not.toHaveProperty("nameSource");
  });
});

describe("E13: user renames", () => {
  it("→ user, witness cleared", () => {
    expect(userRenameUpdates("mine")).toEqual({ name: "mine", nameSource: "user", nameSourceFor: undefined });
    expect(userRenameUpdates("")).toMatchObject({ name: undefined, nameSource: "user" });
  });
});

describe("E14: detach clearing", () => {
  const base = { name: "foo", attachedProposal: "foo" };
  it.each<[Src, boolean]>([[undefined, true], ["auto", true], ["system", true], ["user", false]])(
    "provenance=%j → clear=%s",
    (nameSource, clear) => {
      expect(detachShouldClearName({ ...base, nameSource } as any)).toBe(clear);
    },
  );
  it("a different name is never cleared", () => {
    expect(detachShouldClearName({ name: "my", attachedProposal: "foo", nameSource: "system" } as any)).toBe(false);
  });
  it("a detach revert clears provenance and witness", () => {
    expect(systemRenameUpdates({ nameSource: "system" }, "")).toEqual({ name: undefined, nameSource: undefined, nameSourceFor: undefined });
  });
});

describe("E17: buildAutoNameRestore", () => {
  const stop = (extra: object = {}) => ({
    hardStopped: true, errorEmitted: false, attemptsUsed: 0, starvedCount: 0, waitingCount: 0, sawStarved: false, hasAutoName: false, ...extra,
  });
  it("no state + no provenance → no restore", () => {
    expect(buildAutoNameRestore({ autoNamerState: undefined, nameSource: undefined } as any)).toBeUndefined();
    expect(buildAutoNameRestore(undefined)).toBeUndefined();
  });
  it("system without state → restore system + witness", () => {
    const m = buildAutoNameRestore({ nameSource: "system", nameSourceFor: "add-x" } as any)!;
    expect(m).toMatchObject({ type: "auto_name_state_restore", nameSource: "system", nameSourceFor: "add-x" });
    expect(m.state.hardStopped).toBe(false);
  });
  it("auto + bridge-persisted provenance user + cause-less stop → auto, stop cleared (session-owned provenance)", () => {
    const m = buildAutoNameRestore({
      nameSource: "auto", nameSourceFor: "A",
      autoNamerState: stop({ nameSource: "user" }),
    } as any)!;
    expect(m.nameSource).toBe("auto");
    expect(m.state.hardStopped).toBe(false);
    // provenance never leaks from the persisted state blob
    expect(m.state).not.toHaveProperty("nameSource");
    expect(m.state).not.toHaveProperty("hasAutoName");
  });
  it("auto + a stop WITH stopCause keeps the stop", () => {
    const m = buildAutoNameRestore({
      nameSource: "auto", nameSourceFor: "A",
      autoNamerState: stop({ stopCause: "budget", attemptsUsed: 3, stoppedReason: "r" }),
    } as any)!;
    expect(m.state).toMatchObject({ hardStopped: true, stopCause: "budget", attemptsUsed: 3, stoppedReason: "r" });
  });
  it("user + stopped → user, hardStopped true", () => {
    const m = buildAutoNameRestore({ nameSource: "user", autoNamerState: stop() } as any)!;
    expect(m.nameSource).toBe("user");
    expect(m.state.hardStopped).toBe(true);
  });
  it("legacy: state only, no provenance → today's stop-only restore", () => {
    const m = buildAutoNameRestore({ autoNamerState: stop({ stopCause: "role" }) } as any)!;
    expect(m).not.toHaveProperty("nameSource");
    expect(m.state.hardStopped).toBe(true);
  });
});
