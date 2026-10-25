/**
 * Drift test (design D2): adapter profiles ↔ `package.json` claims ↔ `craft-apps` registry ↔ server/client
 * tables cannot drift. Test-plan #E1 (claims per verified app), #E2 (fallback bounds), #E3 (one craft mode
 * per extension), #E28 (unconfirmed-open check in the first-overwrite notice), plus bundling (E24 of
 * edit-office-in-pane-with-craft-web) and the manifest/config-schema contract.
 * See change: edit-office-in-pane-with-craft-web (D1), extend-craft-web-to-all-apps (D1, D2, D4).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { getApp } from "@blackbelt-technology/pi-dashboard-craft-apps/registry.js";
import { HANDLER_MAX_BYTES } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/file-handler.js";
import { OFFICE_SIZE_CAPS } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../../../dashboard-plugin-runtime/src/manifest-validator.js";
import * as settingsModule from "../client/CraftWebSettings.js";
import { CLAIMED_WEB_APP_IDS, CRAFT_WEB_APPS as CLIENT_CLAIMS } from "../client/craft-apps-table.js";
import * as clientBarrel from "../client/handlers.js";
import { CLAIM_APP, CLAIMED_APPS, CRAFT_WEB_APPS } from "../server/apps.js";
import { ROUTES } from "../server/validators/index.mjs";
import {
  CRAFT_APP_PROFILES,
  type CraftAppProfile,
  capForExtension,
  claimProfile,
  frameProfile,
  unconfirmedOpenCheck,
  unconfirmedOpenSentence,
} from "../shared/app-profiles.js";
import { FAKECRAFT_PROFILE } from "../shared/fixture-profile.js";
import { profileErrors } from "../shared/profile-checks.js";

const root = path.resolve(__dirname, "..", "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as Record<string, unknown> & {
  files: string[];
  "pi-dashboard-plugin": Record<string, unknown>;
};
const manifest = pkg["pi-dashboard-plugin"];
const serverPkg = JSON.parse(readFileSync(path.resolve(root, "..", "server", "package.json"), "utf8")) as { piDashboard: { bundledPlugins: string[] } };

const validated = validateManifest(manifest, "craft-web");
const allFileClaims = validated.claims.filter((c) => c.slot === "editor-pane-file-handler");
/** The FakeCraft fixture claim (add-craft-live-control D8) is declared in the manifest but is not a shipped app. */
const fixtureClaim = allFileClaims.find((c) => c.id === FAKECRAFT_PROFILE.claims[0].id);
const claims = allFileClaims.filter((c) => c !== fixtureClaim);

/** Expected first-overwrite notice of a claim (D4): no-title apps lead with the unconfirmed-open check. */
const expectedNotice = (p: CraftAppProfile): string => {
  const note = getApp(p.appId).webFidelityNote as string;
  return p.title ? note : `${unconfirmedOpenCheck(p.label)} ${note}`;
};

describe("craft-web manifest (E1)", () => {
  it("validates against the loader's validator, is `craft-web`, and is disabled by default", () => {
    expect(validated.id).toBe("craft-web");
    expect(validated.defaultEnabled).toBe(false);
    expect(validated.server).toBeTruthy();
    expect(validated.client).toBeTruthy();
    expect(validated.configSchema).toBe("./configSchema.json");
  });

  it("every claim's component is a function export of the claim's lazy `module` (the registry imports by name)", () => {
    for (const c of claims) {
      expect(c.module, "claims load lazily, off the cold landing chunk").toBe("./src/client/handlers.tsx");
      const name = String(c.component);
      expect(typeof (clientBarrel as Record<string, unknown>)[name], `export ${name}`).toBe("function");
    }
  });

  it("every manifest claim has a profile claim and vice versa (id, extensions, mode, siblingExtensions, maxBytes)", () => {
    const profileClaims = CRAFT_APP_PROFILES.flatMap((p) => p.claims);
    expect(claims.map((c) => c.id).sort()).toEqual(profileClaims.map((c) => c.id).sort());
    for (const c of claims) {
      const found = claimProfile(c.id as string);
      expect(found, `claim ${c.id} has no profile`).toBeTruthy();
      const pc = found?.claim;
      expect(c.extensions).toEqual(pc?.extensions);
      expect(c.mode).toBe(pc?.mode);
      expect((c as { siblingExtensions?: string[] }).siblingExtensions).toEqual(pc?.siblingExtensions);
      expect(c.maxBytes).toBe(pc?.maxBytes);
    }
  });

  it("server and client tables are the profile projection", () => {
    expect([...CLAIMED_APPS]).toEqual(CRAFT_APP_PROFILES.map((p) => p.appId));
    expect([...CLAIMED_WEB_APP_IDS]).toEqual([...CLAIMED_APPS]);
    for (const p of CRAFT_APP_PROFILES) {
      expect(CRAFT_WEB_APPS[p.appId]).toEqual({ id: p.appId, claimIds: p.claims.map((c) => c.id), approxDownloadBytes: p.approxDownloadBytes });
      for (const c of p.claims) {
        expect(CLAIM_APP[c.id]).toBe(p.appId);
        expect(CLIENT_CLAIMS[c.id]).toMatchObject({ id: p.appId, claimId: c.id, label: p.label, extensions: c.extensions, mode: c.mode, maxBytes: c.maxBytes });
        expect(CLIENT_CLAIMS[c.id].siblingExtensions).toEqual(c.siblingExtensions ?? []);
      }
    }
    // the client table also holds the FakeCraft fixture claim, which the server table only gets under the fixture flag
    expect(Object.keys(CLIENT_CLAIMS).sort()).toEqual([...Object.keys(CLAIM_APP), FAKECRAFT_PROFILE.claims[0].id].sort());
  });

  it("declares the settings-section claim backed by the lazy CraftWebSettings module (track-latest-craft-web-version)", () => {
    const s = validated.claims.filter((c) => c.slot === "settings-section");
    expect(s).toHaveLength(1);
    expect(s[0].module).toBe("./src/client/CraftWebSettings.tsx");
    expect(typeof (settingsModule as Record<string, unknown>)[String(s[0].component)]).toBe("function");
  });

  it("every profiled app has a verified registry webVersion and a fidelity note", () => {
    for (const p of CRAFT_APP_PROFILES) {
      expect(getApp(p.appId).webVersion, `${p.appId} has no webVersion`).toBeTruthy();
      expect(getApp(p.appId).webFidelityNote, `${p.appId} has no webFidelityNote`).toBeTruthy();
      expect(p.label).toBe(getApp(p.appId).name);
    }
  });

  it("claim fields follow the profile, the registry and the size-cap mapping", () => {
    for (const c of claims) {
      const found = claimProfile(c.id as string);
      if (!found) throw new Error(`claim ${c.id} has no profile`);
      const { profile: p, claim: pc } = found;
      expect(c.keepAlive).toEqual({ max: 3 });
      expect(c.maxBytes).toBeLessThanOrEqual(HANDLER_MAX_BYTES);
      expect(c.maxBytes).toBe(Math.min(...pc.extensions.map(capForExtension)));
      if (pc.mode === "edit") {
        expect(c.copySuffix).toBe(p.appId);
        expect(c.validator).toBe(true);
        expect(c.label).toBe(`Edit in ${p.label}`);
        expect(c.firstOverwriteNotice).toBe(expectedNotice(p));
        expect((c.firstOverwriteNotice as string).length).toBeLessThanOrEqual(300);
      } else {
        expect(c.label).toBe(`View in ${p.label}`);
      }
    }
  });

  it("every edit and sibling extension has a validator dispatcher route (D7: a format without a validator gets no edit claim)", () => {
    for (const p of CRAFT_APP_PROFILES)
      for (const c of p.claims.filter((x) => x.mode === "edit"))
        for (const ext of [...c.extensions, ...(c.siblingExtensions ?? [])]) expect(Object.hasOwn(ROUTES, ext), `${c.id} ${ext}`).toBe(true);
  });

  it("maps extensions to the spec's caps (docx cap for .docx .odt .rtf, sheet for .xlsx, pptx for .pptx, 16 MiB for .svg, else the handler ceiling)", () => {
    expect([".docx", ".odt", ".rtf"].map(capForExtension)).toEqual([OFFICE_SIZE_CAPS.docx, OFFICE_SIZE_CAPS.docx, OFFICE_SIZE_CAPS.docx]);
    expect(capForExtension(".xlsx")).toBe(OFFICE_SIZE_CAPS.sheet);
    expect(capForExtension(".pptx")).toBe(OFFICE_SIZE_CAPS.pptx);
    expect(capForExtension(".svg")).toBe(16 * 1024 * 1024);
    expect(capForExtension(".dxf")).toBe(HANDLER_MAX_BYTES);
  });

  it("ships src/ (the shim and the validator live there) and no tests", () => {
    expect(pkg.files).toContain("src/");
    expect(pkg.files).toContain("!**/__tests__");
  });

  it("configSchema declares apps.<app>.enabled defaulting to true for every profiled app", () => {
    const schema = JSON.parse(readFileSync(path.join(root, "configSchema.json"), "utf8")) as {
      properties: { apps: { properties: Record<string, { $ref: string }> } };
      definitions: { app: { properties: { enabled: { type: string; default: boolean } } } };
    };
    for (const p of CRAFT_APP_PROFILES) expect(schema.properties.apps.properties[p.appId]?.$ref, p.appId).toBe("#/definitions/app");
    expect(schema.definitions.app.properties.enabled).toMatchObject({ type: "boolean", default: true });
  });
});

describe("profile rules (D2)", () => {
  it("the shipped profile table has no rule violations", () => {
    expect(profileErrors(CRAFT_APP_PROFILES)).toEqual([]);
  });

  it("every title pattern is anchored", () => {
    for (const p of CRAFT_APP_PROFILES) if (p.title) expect(p.title.pattern).toMatch(/^\^.*\$$/);
  });

  it("a claim without a profile, or an unanchored title pattern, is reported", () => {
    const base = CRAFT_APP_PROFILES[0];
    expect(profileErrors([{ ...base, title: { pattern: "(.*) - WordCraft" } }]).join("\n")).toMatch(/wordcraft: title pattern must be anchored/);
    expect(profileErrors([{ ...base, claims: [] }]).join("\n")).toMatch(/wordcraft: has no claims/);
  });
});

/** A no-title profile for the bound checks. */
const noTitle = (openedFallbackMs: number | undefined): CraftAppProfile => ({
  appId: "cadcraft",
  label: "CADCraft",
  ready: { kind: "trunk" },
  ...(openedFallbackMs === undefined ? {} : { openedFallbackMs }),
  cleanOnAckedSave: true,
  saveName: "stem",
  latestChannel: false,
  minShimVersion: 2,
  approxDownloadBytes: 1,
  claims: [{ id: "cadcraft", extensions: [".dxf"], mode: "edit", maxBytes: HANDLER_MAX_BYTES }],
});

describe("E2 opened-fallback bounds", () => {
  it("1000 and 15000 pass", () => {
    expect(profileErrors([noTitle(1000)])).toEqual([]);
    expect(profileErrors([noTitle(15000)])).toEqual([]);
  });

  it("999, 15001, a title profile with a fallback, and a no-title profile without one each fail naming the app", () => {
    expect(profileErrors([noTitle(999)]).join()).toMatch(/^cadcraft: openedFallbackMs 999 is outside/);
    expect(profileErrors([noTitle(15001)]).join()).toMatch(/^cadcraft: openedFallbackMs 15001 is outside/);
    expect(profileErrors([noTitle(undefined)]).join()).toMatch(/^cadcraft: openedFallbackMs is required/);
    expect(profileErrors([{ ...noTitle(3000), title: { pattern: "^(.*)$" } }]).join()).toMatch(/^cadcraft: openedFallbackMs is set although/);
  });
});

describe("E3 one craft mode per extension", () => {
  it("no extension is in two claims' extensions, nor in another app's siblingExtensions", () => {
    const owner = new Map<string, string>();
    for (const p of CRAFT_APP_PROFILES)
      for (const c of p.claims)
        for (const e of c.extensions) {
          expect(owner.get(e), `${e} claimed twice`).toBeUndefined();
          owner.set(e, p.appId);
        }
    for (const p of CRAFT_APP_PROFILES)
      for (const c of p.claims) for (const s of c.siblingExtensions ?? []) expect([undefined, p.appId]).toContain(owner.get(s));
    const jpg = CRAFT_APP_PROFILES.flatMap((p) => p.claims).filter((c) => c.extensions.includes(".jpg"));
    expect(jpg.map((c) => c.id)).toEqual(jpg.length ? ["photocraft-raster"] : []);
  });

  it("reports an extension claimed twice and a sibling owned by another app", () => {
    const a = noTitle(3000);
    const b: CraftAppProfile = { ...noTitle(3000), appId: "photocraft", label: "PhotoCraft", claims: [{ id: "photocraft", extensions: [".dxf"], mode: "edit", maxBytes: 1 }] };
    expect(profileErrors([a, b]).join()).toMatch(/photocraft: \.dxf of claim photocraft is already claimed by cadcraft/);
    const c: CraftAppProfile = { ...b, claims: [{ id: "photocraft", extensions: [".png"], siblingExtensions: [".dxf"], mode: "edit", maxBytes: 1 }] };
    expect(profileErrors([a, c]).join()).toMatch(/photocraft: sibling \.dxf of claim photocraft is claimed by another app's cadcraft/);
  });
});

describe("E28 unconfirmed open is checked in core's one question", () => {
  it("every claim of a profile without title leads its notice with the check, ≤ 300 chars", () => {
    for (const p of CRAFT_APP_PROFILES.filter((x) => !x.title)) {
      for (const pc of p.claims.filter((c) => c.mode === "edit")) {
        const c = claims.find((m) => m.id === pc.id);
        expect(String(c?.firstOverwriteNotice).startsWith(unconfirmedOpenSentence(p.label)), pc.id).toBe(true);
        expect(String(c?.firstOverwriteNotice).length).toBeLessThanOrEqual(300);
      }
    }
  });
});

describe("craft-web bundling (E24)", () => {
  it("is a bundled plugin (trusted for serveApp) and depends on craft-apps", () => {
    expect(serverPkg.piDashboard.bundledPlugins).toContain("craft-web-plugin");
    expect((pkg.dependencies as Record<string, string>)["@blackbelt-technology/pi-dashboard-craft-apps"]).toBeTruthy();
  });

  it("repository.directory is packages/craft-web-plugin (runtime-overlay stager maps by it)", () => {
    expect((pkg.repository as { directory: string }).directory).toBe("packages/craft-web-plugin");
  });
});

describe("FakeCraft fixture (add-craft-live-control D8)", () => {
  it("is declared as one manifest claim bound to an exported handler, and valid as a profile", () => {
    expect(fixtureClaim).toBeTruthy();
    expect(fixtureClaim?.extensions).toEqual(FAKECRAFT_PROFILE.claims[0].extensions);
    expect(typeof (clientBarrel as Record<string, unknown>)[String(fixtureClaim?.component)]).toBe("function");
    expect(profileErrors([FAKECRAFT_PROFILE])).toEqual([]);
  });

  it("is in no shipped table: not a profiled app, not a server claim, not a registry app", () => {
    expect(CRAFT_APP_PROFILES.map((p) => p.appId)).not.toContain(FAKECRAFT_PROFILE.appId);
    expect(Object.keys(CLAIM_APP)).not.toContain("fakecraft");
    expect([...CLAIMED_APPS]).not.toContain("fakecraft");
    expect([...CLAIMED_WEB_APP_IDS]).not.toContain("fakecraft");
  });
});

describe("live control profiles (add-craft-live-control)", () => {
  const controlled = CRAFT_APP_PROFILES.filter((p) => p.control);
  const FORBIDDEN = /open|import|new|close|revert|quit|print|url|script|macro|batch/i;

  it("E20 every control profile is verified against the registry build and carries a safe, non-empty allowlist", () => {
    expect(controlled.length).toBeGreaterThan(0);
    for (const p of controlled) {
      const c = p.control as NonNullable<CraftAppProfile["control"]>;
      expect(c.verifiedVersion, p.appId).toBe(getApp(p.appId).webVersion);
      expect(c.allowedCommands.length, p.appId).toBeGreaterThan(0);
      const allowed = new Set(c.allowedCommands);
      for (const r of c.readOnlyCommands) expect(allowed.has(r), `${p.appId} read-only ${r}`).toBe(true);
      for (const sc of c.saveCommands) expect(allowed.has(sc) && !c.readOnlyCommands.includes(sc), `${p.appId} save command ${sc}`).toBe(true);
      expect(c.allowedCommands.filter((x) => FORBIDDEN.test(x)), p.appId).toEqual([]);
      expect(new Set(c.allowedCommands).size, `${p.appId} duplicate allowed command`).toBe(c.allowedCommands.length);
    }
  });

  it("E20 the frame profile of a control app holds only {kind, global}; other apps' frame profile is unchanged", () => {
    for (const p of CRAFT_APP_PROFILES) {
      const fp = frameProfile(p);
      if (p.control) expect(fp.control).toEqual({ kind: p.control.kind, global: p.control.global });
      else expect(Object.hasOwn(fp, "control")).toBe(false);
    }
  });

  it("E26 control needs an edit claim, a valid global and (page-command) a digestCommand", () => {
    const ctl = { kind: "page-api", global: "fakecraft", verifiedVersion: "1", allowedCommands: ["a.b"], readOnlyCommands: [], saveCommands: [], saveParamNames: [] } as const;
    const base = noTitle(3000);
    expect(profileErrors([{ ...base, control: ctl }])).toEqual([]);
    const view: CraftAppProfile = { ...base, control: ctl, claims: [{ id: "cadcraft", extensions: [".dxf"], mode: "preview", maxBytes: 1 }] };
    expect(profileErrors([view]).join()).toMatch(/control requires an edit claim/);
    expect(profileErrors([{ ...base, claims: [], control: ctl }]).join()).toMatch(/control requires an edit claim/);
    expect(profileErrors([{ ...base, control: { ...ctl, global: "Bad Global" } }]).join()).toMatch(/control global/);
    expect(profileErrors([{ ...base, control: { ...ctl, kind: "page-command" } }]).join()).toMatch(/requires digestCommand/);
    expect(profileErrors([{ ...base, control: { ...ctl, kind: "page-command", digestCommand: "x.info" } }])).toEqual([]);
    expect(profileErrors([{ ...base, control: { ...ctl, readOnlyCommands: ["z.z"] } }]).join()).toMatch(/readOnlyCommands lists z\.z/);
    expect(profileErrors([{ ...base, control: { ...ctl, allowedCommands: [] } }]).join()).toMatch(/allowedCommands is empty/);
  });
});

describe("media projects (add-craft-web-media-projects #E10)", () => {
  const film = CRAFT_APP_PROFILES.find((p) => p.appId === "filmcraft") as CraftAppProfile;
  it("FilmCraft owns the .fcproj edit claim with a validator route; .ecproj stays unclaimed", () => {
    expect(film.claims.map((c) => [c.id, c.extensions, c.mode])).toEqual([["filmcraft", [".fcproj"], "edit"]]);
    expect(Object.keys(ROUTES)).toContain(".fcproj");
    expect(CRAFT_APP_PROFILES.flatMap((p) => p.claims.flatMap((c) => c.extensions))).not.toContain(".ecproj");
    expect(CRAFT_APP_PROFILES.filter((p) => p.mediaProject).map((p) => p.appId)).toEqual(["filmcraft"]);
  });
  it("only a media-project profile tells the frame (other apps' profile hash unchanged)", () => {
    expect(frameProfile(film).mediaProject).toBe(true);
    for (const p of CRAFT_APP_PROFILES.filter((x) => x.appId !== "filmcraft")) expect("mediaProject" in frameProfile(p)).toBe(false);
  });
  it("profileErrors names the app for a bad media bound or a missing claim", () => {
    const m = film.mediaProject as NonNullable<CraftAppProfile["mediaProject"]>;
    const withM = (x: Partial<typeof m>) => profileErrors([{ ...film, mediaProject: { ...m, ...x } }]).join("\n");
    expect(withM({})).toBe("");
    expect(withM({ mediaMaxFiles: 0 })).toMatch(/^filmcraft: mediaProject mediaMaxFiles 0 must be a positive integer/);
    expect(withM({ mediaMaxBytes: m.mediaMaxTotalBytes + 1 })).toMatch(/mediaMaxBytes exceeds mediaMaxTotalBytes/);
    expect(withM({ projectMaxBytes: HANDLER_MAX_BYTES + 1 })).toMatch(/projectMaxBytes .* exceeds claim filmcraft maxBytes/);
    expect(profileErrors([{ ...film, claims: [{ ...film.claims[0], extensions: [".other"] }] }]).join("\n")).toMatch(/mediaProject needs an edit claim for \.fcproj/);
  });
  it("FilmCraft's registry web version and fidelity note back the claim", () => {
    expect(getApp("filmcraft")?.webVersion).toBe("0.12.0");
  });
});
