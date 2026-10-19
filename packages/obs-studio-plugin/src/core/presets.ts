/**
 * Idempotent presets in the CURRENT scene collection (design D11). Ported from
 * OBS-Transcribe `scripts/setup-scenes.ts` (1920×1080 canvas, 480×270 PIP box,
 * 20 px margin) and `create-subtitles.ts` (bottom-centred 48 pt text).
 *
 * Rules: one `GetSceneList` before any `CreateScene`; a missing scene is created
 * with its inputs; an EXISTING scene is never modified — expected-but-missing
 * items report `incomplete`; an input name already taken (OBS error 601) reports
 * `existing` and only gets a scene-item reference in a scene this run created.
 * Device binding only for inputs this run created (first non-virtual camera,
 * main display). A filter needing an absent kind reports `plugin-missing`.
 * Never switches the scene collection; never changes an existing input.
 * Geometry is designed on 1920x1080 and scaled to the real base canvas
 * (`GetVideoSettings`; fallback 1920x1080) by k = baseWidth / 1920.
 * See change: add-obs-studio-plugin.
 */
import { DEVICE_KINDS, type Device, type Display, SCREEN_KIND } from "./devices.js";
import { ObsError } from "./errors.js";
import type { Platform } from "./paths.js";
import type { GuardedObs } from "./policy.js";
import { BGREMOVAL_KIND, filterKinds } from "./verbs.js";

type ItemStatus = "created" | "existing" | "incomplete" | "skipped" | "plugin-missing";

export interface ItemReport {
  item: string;
  status: ItemStatus;
  note?: string;
}

const DESIGN_W = 1920;
const DESIGN_H = 1080;
const BOX_W = 480;
const BOX_H = 270;
const MARGIN = 20;

/** Base canvas in pixels plus the design-to-canvas factor. */
interface Canvas {
  w: number;
  h: number;
  k: number;
}

type Transform = (c: Canvas) => Record<string, unknown>;

const FULL: Transform = (c) => ({ boundsType: "OBS_BOUNDS_SCALE_INNER", boundsWidth: c.w, boundsHeight: c.h, positionX: 0, positionY: 0 });
const BOTTOM_RIGHT: Transform = (c) => {
  const [w, h, m] = [BOX_W, BOX_H, MARGIN].map((v) => Math.round(v * c.k));
  return { boundsType: "OBS_BOUNDS_SCALE_INNER", boundsWidth: w, boundsHeight: h, positionX: c.w - w - m, positionY: c.h - h - m };
};
const BOTTOM_CENTER: Transform = (c) => ({ alignment: 8, positionX: Math.round(c.w / 2), positionY: c.h - Math.round(MARGIN * c.k) });

async function readCanvas(obs: GuardedObs): Promise<Canvas> {
  if (!obs.conn.availableRequests.has("GetVideoSettings")) return { w: DESIGN_W, h: DESIGN_H, k: 1 };
  const r = await obs.request<{ baseWidth?: number; baseHeight?: number }>("GetVideoSettings");
  const w = r.baseWidth && r.baseWidth > 0 ? r.baseWidth : DESIGN_W;
  const h = r.baseHeight && r.baseHeight > 0 ? r.baseHeight : DESIGN_H;
  return { w, h, k: w / DESIGN_W };
}

type Source = "camera" | "screen" | "text";

interface InputSpec {
  name: string;
  source: Source;
  transform: Transform;
  settings?: (c: Canvas) => Record<string, unknown>;
}

interface FilterSpec {
  source: string;
  name: string;
  kind: string;
  settings: Record<string, unknown>;
  /** Report `plugin-missing` when the kind is not installed. */
  optionalKind?: boolean;
}

interface SceneSpec {
  scene: string;
  inputs: InputSpec[];
}

interface PresetSpec {
  /** Scenes the preset creates when missing. */
  scenes: SceneSpec[];
  filters: FilterSpec[];
  /** Add `inputs` to these scenes only when they already exist or were created this run. */
  overlay?: { scenes: string[]; input: InputSpec };
}

const SUBTITLE_SETTINGS = (c: Canvas) => ({
  text: "",
  font: { face: "Helvetica", size: Math.round(48 * c.k), style: "Bold", flags: 0 },
  color1: 0xffffffff,
  color2: 0xffffffff,
  outline: true,
  drop_shadow: true,
  word_wrap: true,
  custom_width: Math.round(1600 * c.k),
});

const PIP: SceneSpec = {
  scene: "Desktop + Webcam",
  inputs: [
    { name: "Desktop Combined", source: "screen", transform: FULL },
    { name: "Webcam Box", source: "camera", transform: BOTTOM_RIGHT },
  ],
};

const PRESETS: Record<string, PresetSpec> = {
  webcam: { scenes: [{ scene: "Webcam", inputs: [{ name: "Webcam Full", source: "camera", transform: FULL }] }], filters: [] },
  desktop: { scenes: [{ scene: "Desktop", inputs: [{ name: "Desktop Full", source: "screen", transform: FULL }] }], filters: [] },
  "desktop-webcam-pip": {
    scenes: [PIP],
    filters: [{ source: "Webcam Box", name: "Green Screen", kind: "chroma_key_filter_v2", settings: { key_color_type: "green" } }],
  },
  "pip-bgremoval": {
    scenes: [PIP],
    filters: [{ source: "Webcam Box", name: "Background Removal", kind: BGREMOVAL_KIND, settings: {}, optionalKind: true }],
  },
  subtitles: {
    scenes: [],
    filters: [],
    overlay: {
      scenes: ["Webcam", "Desktop", "Desktop + Webcam"],
      input: { name: "Subtitles", source: "text", transform: BOTTOM_CENTER, settings: SUBTITLE_SETTINGS },
    },
  },
};

export const PRESET_NAMES = Object.keys(PRESETS);

const TEXT_KIND: Record<Platform, string> = { darwin: "text_ft2_source_v2", win32: "text_gdiplus_v3", linux: "text_ft2_source_v2" };

function inputKind(platform: Platform, source: Source): string {
  if (source === "camera") return DEVICE_KINDS[platform].camera.inputKind;
  if (source === "screen") return SCREEN_KIND[platform];
  return TEXT_KIND[platform];
}

export interface PresetDeps {
  platform: Platform;
  /** Non-virtual cameras (only called when a camera input was created). */
  listCameras: () => Promise<Device[]>;
  listDisplays: () => Promise<Display[] | "unsupported">;
}

const obsCode = (e: unknown) => (e as ObsError)?.detail?.obsCode;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: sequential scene, overlay and filter phases reporting per item
export async function applyPreset(obs: GuardedObs, name: string, deps: PresetDeps): Promise<ItemReport[]> {
  const spec = PRESETS[name];
  if (!spec) throw new ObsError("usage", `unknown preset ${JSON.stringify(name)}; available: ${PRESET_NAMES.join(", ")}`);
  const report: ItemReport[] = [];
  const { scenes = [] } = await obs.request<{ scenes?: Array<{ sceneName: string }> }>("GetSceneList");
  const existingScenes = new Set(scenes.map((s) => s.sceneName));
  const createdScenes = new Set<string>();
  const createdInputs = new Map<string, Source>();
  let canvas: Canvas | undefined;

  const sceneItems = async (scene: string): Promise<Set<string>> => {
    const { sceneItems: items = [] } = await obs.request<{ sceneItems?: Array<{ sourceName: string }> }>("GetSceneItemList", { sceneName: scene });
    return new Set(items.map((i) => i.sourceName));
  };

  const placeInput = async (scene: string, input: InputSpec): Promise<void> => {
    canvas ??= await readCanvas(obs);
    let sceneItemId: number;
    try {
      const r = await obs.request<{ sceneItemId: number }>("CreateInput", {
        sceneName: scene,
        inputName: input.name,
        inputKind: inputKind(deps.platform, input.source),
        inputSettings: input.settings?.(canvas) ?? {},
        sceneItemEnabled: true,
      });
      sceneItemId = r.sceneItemId;
      createdInputs.set(input.name, input.source);
      report.push({ item: `input:${input.name}`, status: "created" });
    } catch (e) {
      if (obsCode(e) !== 601) throw e;
      // The name is taken: reference the existing source in OUR new scene, never touch its settings.
      const r = await obs.request<{ sceneItemId: number }>("CreateSceneItem", { sceneName: scene, sourceName: input.name, sceneItemEnabled: true });
      sceneItemId = r.sceneItemId;
      report.push({ item: `input:${input.name}`, status: "existing", note: `added to ${scene}` });
    }
    await obs.request("SetSceneItemTransform", { sceneName: scene, sceneItemId, sceneItemTransform: input.transform(canvas) });
  };

  for (const s of spec.scenes) {
    if (existingScenes.has(s.scene)) {
      const items = await sceneItems(s.scene);
      const missing = s.inputs.filter((i) => !items.has(i.name)).map((i) => i.name);
      report.push({ item: `scene:${s.scene}`, status: missing.length ? "incomplete" : "existing", ...(missing.length ? { note: `missing: ${missing.join(", ")}` } : {}) });
      for (const i of s.inputs) report.push({ item: `input:${i.name}`, status: items.has(i.name) ? "existing" : "incomplete" });
      continue;
    }
    await obs.request("CreateScene", { sceneName: s.scene });
    createdScenes.add(s.scene);
    report.push({ item: `scene:${s.scene}`, status: "created" });
    for (const i of s.inputs) await placeInput(s.scene, i);
  }

  if (spec.overlay) {
    const { input } = spec.overlay;
    for (const scene of spec.overlay.scenes) {
      if (!existingScenes.has(scene) && !createdScenes.has(scene)) {
        report.push({ item: `scene:${scene}`, status: "skipped", note: "scene absent" });
        continue;
      }
      const items = await sceneItems(scene);
      if (items.has(input.name)) {
        report.push({ item: `${scene}/${input.name}`, status: "existing" });
        continue;
      }
      // Adding the overlay item is this preset's whole purpose (a new scene item; no existing input changes).
      await placeInput(scene, input);
    }
  }

  if (spec.filters.length) {
    const kinds = await filterKinds(obs);
    for (const f of spec.filters) {
      const item = `filter:${f.source}/${f.name}`;
      if (!createdInputs.has(f.source)) {
        report.push({ item, status: "skipped", note: "input not created by this run; its filters are left as they are" });
        continue;
      }
      if (f.optionalKind && !kinds.has(f.kind)) {
        report.push({ item, status: "plugin-missing", note: `${f.kind} filter kind not installed` });
        continue;
      }
      await obs.request("CreateSourceFilter", { sourceName: f.source, filterName: f.name, filterKind: f.kind, filterSettings: f.settings });
      report.push({ item, status: "created" });
    }
  }

  await bindCreated(obs, createdInputs, deps, report);
  return report;
}

async function bindCreated(obs: GuardedObs, created: Map<string, Source>, deps: PresetDeps, report: ItemReport[]): Promise<void> {
  const cams = [...created].filter(([, s]) => s === "camera").map(([n]) => n);
  const screens = [...created].filter(([, s]) => s === "screen").map(([n]) => n);
  if (cams.length) {
    const camera = (await deps.listCameras().catch(() => []))[0];
    for (const inputName of cams) {
      if (!camera) {
        report.push({ item: `bind:${inputName}`, status: "skipped", note: "no physical camera found" });
        continue;
      }
      await obs.request("SetInputSettings", { inputName, inputSettings: { [DEVICE_KINDS[deps.platform].camera.property]: camera.id }, overlay: true });
      report.push({ item: `bind:${inputName}`, status: "created", note: camera.name });
    }
  }
  if (screens.length) {
    const displays = await deps.listDisplays().catch(() => "unsupported" as const);
    const main = displays === "unsupported" ? undefined : (displays.find((d) => d.main) ?? displays[0]);
    for (const inputName of screens) {
      if (!main) {
        report.push({ item: `bind:${inputName}`, status: "skipped", note: "display listing unsupported here; bind with pi-obs input bind --display" });
        continue;
      }
      await obs.request("SetInputSettings", { inputName, inputSettings: { display_uuid: main.id }, overlay: true });
      report.push({ item: `bind:${inputName}`, status: "created", note: main.id });
    }
  }
}
