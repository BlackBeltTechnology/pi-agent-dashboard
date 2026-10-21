/**
 * Device discovery + input binding (design D11, spike F4/F9).
 *
 * Cameras / audio: the property items of an existing input of the kind; when
 * none exists, a temporary `pi-obs-probe-<kind>` input in a dedicated scene
 * `pi-obs-probe` (never the program scene), refused while streaming or
 * recording, removed in `finally`. Leftover probes are swept at every live
 * verb, `serve` start and `doctor --live` (`sweepProbes`).
 * Displays: macOS via the JXA CoreGraphics bridge (`CGDisplayCreateUUIDFromDisplayID`,
 * accepted by `screen_capture` as `display_uuid` on 32.2.2); elsewhere `unsupported`.
 * `OBS Virtual Camera` is excluded from camera lists and refused by `input bind`
 * (feeding the output back into itself).
 * See change: add-obs-studio-plugin.
 */
import { ObsError } from "./errors.js";
import type { Platform } from "./paths.js";
import type { GuardedObs } from "./policy.js";

export type DeviceKind = "camera" | "audio" | "display";

const PROBE_SCENE = "pi-obs-probe";
const PROBE_PREFIX = "pi-obs-probe";

/** Input kind + device property per platform. */
export const DEVICE_KINDS: Record<Platform, Record<"camera" | "audio", { inputKind: string; property: string }>> = {
  darwin: {
    camera: { inputKind: "av_capture_input_v2", property: "device" },
    audio: { inputKind: "coreaudio_input_capture", property: "device_id" },
  },
  win32: {
    camera: { inputKind: "dshow_input", property: "video_device_id" },
    audio: { inputKind: "wasapi_input_capture", property: "device_id" },
  },
  linux: {
    camera: { inputKind: "v4l2_input", property: "device_id" },
    audio: { inputKind: "pulse_input_capture", property: "device_id" },
  },
};

export const SCREEN_KIND: Record<Platform, string> = { darwin: "screen_capture", win32: "monitor_capture", linux: "xshm_input" };

export interface Device {
  id: string;
  name: string;
}

export interface Display {
  id: string;
  /** Global CoreGraphics position (left monitor x = 0); absent from older listers. */
  x?: number;
  y?: number;
  width: number;
  height: number;
  main: boolean;
  mirrored?: boolean;
}

export type DisplayLister = () => Promise<Display[] | "unsupported">;

const VIRTUAL_CAMERA = /obs virtual camera/i;

function isVirtualCamera(d: Device): boolean {
  return VIRTUAL_CAMERA.test(d.name) || VIRTUAL_CAMERA.test(d.id);
}

interface InputRow {
  inputName: string;
  inputKind?: string;
}

/** Remove leftover `pi-obs-probe*` inputs and scenes from an interrupted run. */
export async function sweepProbes(obs: GuardedObs): Promise<string[]> {
  const removed: string[] = [];
  const has = (t: string) => obs.conn.availableRequests.has(t);
  if (has("GetInputList") && has("RemoveInput")) {
    const { inputs = [] } = await obs.request<{ inputs?: InputRow[] }>("GetInputList");
    for (const i of inputs) {
      if (!i.inputName.startsWith(PROBE_PREFIX)) continue;
      await obs.request("RemoveInput", { inputName: i.inputName });
      removed.push(`input:${i.inputName}`);
    }
  }
  if (has("GetSceneList") && has("RemoveScene")) {
    const { scenes = [] } = await obs.request<{ scenes?: Array<{ sceneName: string }> }>("GetSceneList");
    for (const s of scenes) {
      if (s.sceneName !== PROBE_SCENE) continue;
      await obs.request("RemoveScene", { sceneName: s.sceneName });
      removed.push(`scene:${s.sceneName}`);
    }
  }
  return removed;
}

async function outputsActive(obs: GuardedObs): Promise<boolean> {
  for (const t of ["GetStreamStatus", "GetRecordStatus"]) {
    if (!obs.conn.availableRequests.has(t)) continue;
    const r = await obs.request<{ outputActive?: boolean }>(t);
    if (r.outputActive) return true;
  }
  return false;
}

async function propertyItems(obs: GuardedObs, inputName: string, property: string): Promise<Device[]> {
  const { propertyItems = [] } = await obs.request<{ propertyItems?: Array<{ itemName?: string; itemValue?: unknown }> }>(
    "GetInputPropertiesListPropertyItems",
    { inputName, propertyName: property },
  );
  return propertyItems
    .filter((p) => p.itemValue !== undefined && p.itemValue !== "")
    .map((p) => ({ id: String(p.itemValue), name: String(p.itemName ?? p.itemValue) }));
}

/** Every device of `kind` as OBS reports it (virtual camera INCLUDED; callers filter). */
async function rawDevices(obs: GuardedObs, platform: Platform, kind: "camera" | "audio"): Promise<Device[]> {
  const { inputKind, property } = DEVICE_KINDS[platform][kind];
  const { inputs = [] } = await obs.request<{ inputs?: InputRow[] }>("GetInputList", { inputKind });
  const existing = inputs.find((i) => !i.inputName.startsWith(PROBE_PREFIX));
  if (existing) return propertyItems(obs, existing.inputName, property);

  if (await outputsActive(obs)) {
    throw new ObsError("output-active", `no ${kind} input exists to read devices from, and a temporary probe input is refused while streaming or recording`);
  }
  const probe = `${PROBE_PREFIX}-${kind}`;
  try {
    await obs.request("CreateScene", { sceneName: PROBE_SCENE });
    await obs.request("CreateInput", { sceneName: PROBE_SCENE, inputName: probe, inputKind, inputSettings: {}, sceneItemEnabled: false });
    return await propertyItems(obs, probe, property);
  } finally {
    await obs.request("RemoveInput", { inputName: probe }).catch(() => {});
    await obs.request("RemoveScene", { sceneName: PROBE_SCENE }).catch(() => {});
  }
}

export interface DeviceDeps {
  platform: Platform;
  listDisplays: DisplayLister;
}

export async function listCameras(obs: GuardedObs, platform: Platform): Promise<Device[]> {
  return (await rawDevices(obs, platform, "camera")).filter((d) => !isVirtualCamera(d));
}

export async function listDevices(obs: GuardedObs, kind: DeviceKind, deps: DeviceDeps): Promise<{ kind: DeviceKind; devices: Array<Device | Display> | "unsupported"; warning?: string }> {
  if (kind === "display") {
    const displays = await deps.listDisplays();
    if (displays === "unsupported") return { kind, devices: "unsupported" };
    const warning = displays.some((d) => d.mirrored) ? "mirrored displays detected; OBS may capture only the mirror source" : undefined;
    return { kind, devices: displays, ...(warning ? { warning } : {}) };
  }
  if (kind === "camera") return { kind, devices: await listCameras(obs, deps.platform) };
  return { kind, devices: await rawDevices(obs, deps.platform, "audio") };
}

/** Bind an input to a device id or a display UUID (property chosen by the input's kind). */
export async function bindInput(
  obs: GuardedObs,
  inputName: string,
  target: { device?: string; display?: string },
  deps: DeviceDeps,
): Promise<{ input: string; property: string; value: string }> {
  const { inputs = [] } = await obs.request<{ inputs?: InputRow[] }>("GetInputList");
  const input = inputs.find((i) => i.inputName === inputName);
  if (!input) throw new ObsError("not-found", `no input named ${JSON.stringify(inputName)}`);
  let property: string;
  let value: string;
  if (target.display !== undefined) {
    if (input.inputKind !== SCREEN_KIND[deps.platform]) throw new ObsError("refused", `${inputName} is not a screen-capture input`);
    property = "display_uuid";
    value = target.display;
  } else if (target.device !== undefined) {
    const kind = (Object.keys(DEVICE_KINDS[deps.platform]) as Array<"camera" | "audio">).find((k) => DEVICE_KINDS[deps.platform][k].inputKind === input.inputKind);
    if (!kind) throw new ObsError("refused", `${inputName} (${input.inputKind ?? "unknown kind"}) is not a camera or audio input`);
    property = DEVICE_KINDS[deps.platform][kind].property;
    if (kind === "camera") {
      const items = await propertyItems(obs, inputName, property);
      const hit = items.find((d) => d.id === target.device);
      if (isVirtualCamera(hit ?? { id: target.device, name: "" })) {
        throw new ObsError("refused", "binding the OBS Virtual Camera into a scene feeds OBS's output back into itself (feedback loop); pick a physical camera");
      }
    }
    value = target.device;
  } else {
    throw new ObsError("usage", "input bind needs --device <id> or --display <uuid>");
  }
  await obs.request("SetInputSettings", { inputName, inputSettings: { [property]: value }, overlay: true });
  return { input: inputName, property, value };
}

/**
 * JXA source listing active displays with their CoreGraphics UUID (spike F4).
 * Display ids come from `NSScreen.screens`: a JXA `Ref()` passed to
 * `CGGetActiveDisplayList` only exposes element 0 (`ids[1]` is `undefined`),
 * which made every display report the main display's UUID.
 */
export const JXA_DISPLAYS = `
ObjC.import("AppKit"); ObjC.import("CoreGraphics"); ObjC.import("ColorSync");
var screens = $.NSScreen.screens, out = [];
for (var i = 0; i < screens.count; i++) {
  var id = screens.objectAtIndex(i).deviceDescription.objectForKey("NSScreenNumber").unsignedIntValue;
  var uuid = ObjC.castRefToObject($.CFUUIDCreateString(null, $.CGDisplayCreateUUIDFromDisplayID(id))).js;
  var b = $.CGDisplayBounds(id);
  out.push({ id: uuid, x: b.origin.x, y: b.origin.y, width: b.size.width, height: b.size.height, main: $.CGDisplayIsMain(id) === 1, mirrored: $.CGDisplayIsInMirrorSet(id) === 1 });
}
JSON.stringify(out);
`;

/** Parse `osascript -l JavaScript` output of `JXA_DISPLAYS`. */
export function parseDisplays(stdout: string): Display[] {
  const rows = JSON.parse(stdout.trim()) as Array<Partial<Display>>;
  return rows
    .filter((r) => typeof r.id === "string" && r.id.length > 0)
    .map((r) => ({
      id: String(r.id),
      ...(typeof r.x === "number" ? { x: r.x } : {}),
      ...(typeof r.y === "number" ? { y: r.y } : {}),
      width: Number(r.width ?? 0),
      height: Number(r.height ?? 0),
      main: r.main === true,
      ...(r.mirrored ? { mirrored: true } : {}),
    }));
}

/** How long a flipped display is held so OBS tears down and restarts the capture stream. */
export const CAPTURE_REFRESH_HOLD_MS = 1500;

export interface CaptureRefreshResult {
  refreshed: Array<{ input: string; via: "flip" | "reapply" }>;
}

/**
 * Unfreeze macOS screen captures after sleep (observed OBS 31.1.2): the
 * ScreenCaptureKit stream stops on sleep (`Stream stopped with error 0`) and
 * never restarts; toggling visibility or re-applying the same settings does
 * not restart it. Flip each input's `display_uuid` to another display, hold
 * `CAPTURE_REFRESH_HOLD_MS`, then restore the original settings exactly
 * (`overlay:false`, so `{}` stays `{}`). The restore runs in `finally`.
 * One display → re-apply only (`via: "reapply"`). Never enumerates
 * `screen_capture` properties (crashes OBS).
 */
export async function refreshScreenCaptures(
  obs: GuardedObs,
  opts: { input?: string },
  deps: DeviceDeps & { sleep: (ms: number) => Promise<void> },
): Promise<CaptureRefreshResult> {
  if (deps.platform !== "darwin") throw new ObsError("refused", "capture refresh is macOS-only (ScreenCaptureKit sleep freeze)");
  const { inputs = [] } = await obs.request<{ inputs?: InputRow[] }>("GetInputList");
  let targets = inputs.filter((i) => i.inputKind === SCREEN_KIND.darwin).map((i) => i.inputName);
  if (opts.input !== undefined) {
    const hit = inputs.find((i) => i.inputName === opts.input);
    if (!hit) throw new ObsError("not-found", `no input named ${JSON.stringify(opts.input)}`);
    if (hit.inputKind !== SCREEN_KIND.darwin) throw new ObsError("refused", `${opts.input} is not a screen-capture input`);
    targets = [opts.input];
  }
  const listed = await deps.listDisplays();
  const displays = listed === "unsupported" ? [] : listed;
  const mainId = displays.find((d) => d.main)?.id;
  const refreshed: CaptureRefreshResult["refreshed"] = [];
  for (const inputName of targets) {
    const { inputSettings = {} } = await obs.request<{ inputSettings?: Record<string, unknown> }>("GetInputSettings", { inputName });
    const original = { ...inputSettings };
    // Empty settings capture OBS's default, the main display.
    const current = typeof original.display_uuid === "string" ? original.display_uuid : mainId;
    const other = displays.find((d) => d.id !== current)?.id;
    if (!other) {
      await obs.request("SetInputSettings", { inputName, inputSettings: original, overlay: false });
      refreshed.push({ input: inputName, via: "reapply" });
      continue;
    }
    await obs.request("SetInputSettings", { inputName, inputSettings: { display_uuid: other }, overlay: true });
    try {
      await deps.sleep(CAPTURE_REFRESH_HOLD_MS);
    } finally {
      await obs.request("SetInputSettings", { inputName, inputSettings: original, overlay: false });
    }
    refreshed.push({ input: inputName, via: "flip" });
  }
  return { refreshed };
}
