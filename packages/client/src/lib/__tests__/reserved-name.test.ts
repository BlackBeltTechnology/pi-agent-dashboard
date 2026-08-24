/**
 * Gateway Setup step 3 state — the seven states the reserved-name field can be
 * in, asserted as a pure function of (stored, draft, outcome).
 *
 * Task 4.1 / test-plan E1–E6 mirrored client-side. The point of testing the
 * MIRROR is that it must agree with the server's `RESERVED_NAME_RE` on every
 * boundary: a client that accepts what the server rejects turns instant inline
 * feedback into a lie, and one that rejects what the server accepts silently
 * forbids legal names.
 *
 * See change: add-zrok-custom-reserved-name.
 */
import { describe, expect, it } from "vitest";
import {
  localValidationError,
  needsReplaceConfirm,
  RESERVED_NAME_MAX,
  RESERVED_NAME_RE,
  reservedNameStepState,
  reservedNameUrl,
} from "../gateway/reserved-name.js";

describe("client mirror of RESERVED_NAME_RE", () => {
  // The server's regex, copied here verbatim from
  // packages/server/src/tunnel-providers/zrok.ts. If these ever diverge the
  // mirror is worse than no mirror.
  const SERVER_RE = /^[a-z0-9][a-z0-9-]{0,62}$/i;

  const cases = [
    "a", // E1 minimum
    `a${"b".repeat(62)}`, // E2 maximum (63)
    `a${"b".repeat(63)}`, // E3 one over
    "", // E4 empty
    "-lead", // E5 leading hyphen
    "has_underscore", // E6 charset
    "robson-home-mac",
    "MiXeDcAsE",
    "9starts-with-digit",
    "trailing-",
    "has space",
    "has.dot",
  ];

  for (const name of cases) {
    it(`agrees with the server on ${JSON.stringify(name)}`, () => {
      expect(RESERVED_NAME_RE.test(name)).toBe(SERVER_RE.test(name));
    });
  }

  it("caps at 63, the length the server's {0,62} quantifier implies", () => {
    expect(RESERVED_NAME_MAX).toBe(63);
  });
});

describe("localValidationError states a fix, not just a rejection", () => {
  it("names the length and the limit when too long", () => {
    const msg = localValidationError(`a${"b".repeat(63)}`);
    expect(msg).toContain("63");
    expect(msg).toContain("64");
  });

  it("names hyphens as the alternative to an underscore", () => {
    expect(localValidationError("has_underscore")).toMatch(/hyphen/i);
  });

  it("explains that a leading hyphen must become a letter or digit", () => {
    expect(localValidationError("-lead")).toMatch(/start with a letter or a digit/i);
  });

  it("accepts every valid name", () => {
    for (const n of ["a", "robson-home-mac", `a${"b".repeat(62)}`]) {
      expect(localValidationError(n), n).toBeNull();
    }
  });
});

describe("reservedNameStepState", () => {
  it("idle: nothing stored, nothing typed", () => {
    expect(reservedNameStepState({ draft: "" })).toEqual({ kind: "idle" });
  });

  it("typing-valid: a locally acceptable name that is not the stored one", () => {
    expect(reservedNameStepState({ draft: "robson-home-mac" })).toEqual({
      kind: "typing-valid",
      name: "robson-home-mac",
    });
  });

  it("invalid: rejected locally, so no request is worth making", () => {
    const s = reservedNameStepState({ draft: "-lead" });
    expect(s.kind).toBe("invalid");
    expect(s.kind === "invalid" && s.message).toMatch(/hyphen/i);
  });

  it("taken: the server's reason is surfaced verbatim, not replaced by a generic one", () => {
    const s = reservedNameStepState({
      draft: "popular",
      submitted: true,
      outcome: { status: "taken", name: "popular", message: "“popular” is reserved on another zrok account." },
    });
    expect(s).toEqual({
      kind: "taken",
      name: "popular",
      message: "“popular” is reserved on another zrok account.",
    });
  });

  it("write-failed is a DISTINCT state from taken — the name IS reserved remotely", () => {
    const s = reservedNameStepState({
      draft: "n",
      submitted: true,
      outcome: { status: "write-failed", name: "n", message: "could not write config" },
    });
    expect(s.kind).toBe("write-failed");
  });

  it("reserved: a stored name with an untouched field", () => {
    expect(reservedNameStepState({ stored: "robson-home-mac", draft: "" })).toEqual({
      kind: "reserved",
      name: "robson-home-mac",
    });
  });

  it("reserved: carries the live-URL-unchanged indication when the endpoint reported one", () => {
    const s = reservedNameStepState({
      draft: "new-name",
      submitted: true,
      outcome: { status: "ok", name: "new-name", liveUrlUnchanged: "https://old.shares.zrok.io" },
    });
    expect(s).toEqual({
      kind: "reserved",
      name: "new-name",
      liveUrlUnchanged: "https://old.shares.zrok.io",
    });
  });

  it("replace-confirm: replacing a stored name is destructive and gated", () => {
    expect(
      reservedNameStepState({ stored: "old-name", draft: "new-name", confirming: true }),
    ).toEqual({ kind: "replace-confirm", current: "old-name", next: "new-name" });
  });

  it("does NOT re-litigate a stale outcome against a newly typed name", () => {
    // The user was told "taken", then typed something else. Showing the old
    // rejection under the new name would attribute a reason to the wrong input.
    const s = reservedNameStepState({
      draft: "different",
      submitted: true,
      outcome: { status: "taken", name: "popular", message: "taken" },
    });
    expect(s).toEqual({ kind: "typing-valid", name: "different" });
  });

  it("treats a name equal to the stored one as reserved, not as a pending edit", () => {
    expect(reservedNameStepState({ stored: "same", draft: "same" })).toEqual({ kind: "reserved", name: "same" });
  });

  it("ignores surrounding whitespace rather than reserving it", () => {
    expect(reservedNameStepState({ draft: "  robson-home-mac  " })).toEqual({
      kind: "typing-valid",
      name: "robson-home-mac",
    });
  });
});

describe("destructive-replace gating", () => {
  it("requires confirmation only when a DIFFERENT name would replace a stored one", () => {
    expect(needsReplaceConfirm("old", "new")).toBe(true);
    expect(needsReplaceConfirm("old", "old")).toBe(false);
    expect(needsReplaceConfirm(undefined, "new")).toBe(false);
    expect(needsReplaceConfirm("old", "  ")).toBe(false);
  });

  it("renders the exact URL being destroyed, so the copy cannot say 'the old name'", () => {
    expect(reservedNameUrl("robson-home-mac")).toBe("https://robson-home-mac.shares.zrok.io");
  });
});

/**
 * The resync-on-`stored`-change effect and the outcome state can fight.
 *
 * A successful set calls `onStoredChange`, which returns as a NEW `stored`. If
 * that echo is treated as an external change the component clears `submitted`
 * and discards the outcome it is currently rendering — losing `tunnelStopped`,
 * which is the one thing the operator needs to read after a replace, and
 * blanking the reason for `taken`/`write-failed` too.
 *
 * The state function is what makes the distinction checkable: an outcome whose
 * name matches the draft must survive a `stored` that now equals it.
 */
describe("a stored echo must not discard the outcome being rendered", () => {
  it("keeps the tunnelStopped signal when stored catches up to the name just set", () => {
    const s = reservedNameStepState({
      stored: "new-name", // the echo of our own successful set
      draft: "new-name",
      submitted: true,
      outcome: { status: "ok", name: "new-name", tunnelStopped: true },
    });
    expect(s).toEqual({
      kind: "reserved",
      name: "new-name",
      liveUrlUnchanged: undefined,
      tunnelStopped: true,
    });
  });

  it("still surfaces a rejection while nothing is stored", () => {
    // `taken` and `write-failed` never update `stored`, so an unconditional
    // resync on every render would blank their reason entirely.
    const s = reservedNameStepState({
      stored: undefined,
      draft: "robson-home-mac",
      submitted: true,
      outcome: { status: "write-failed", name: "robson-home-mac", message: "could not write" },
    });
    expect(s.kind).toBe("write-failed");
    expect(s.kind === "write-failed" && s.message).toBe("could not write");
  });
});
