/**
 * Live control verbs over a policy-guarded connection (design D11). Each
 * returns a JSON-able result; the CLI prints it (`--json`) or a summary.
 * The stream key is taken as a parameter (read from stdin by the CLI) and
 * never echoed. See change: add-obs-studio-plugin.
 */
import { ObsError } from "./errors.js";
import type { GuardedObs } from "./policy.js";

export interface ObsStatus {
  obsVersion: string;
  wsVersion: string;
  currentScene: string | null;
  virtualCam: boolean | null;
  recording: boolean | null;
  streaming: boolean | null;
}

async function optional<T>(obs: GuardedObs, type: string, pick: (r: Record<string, unknown>) => T): Promise<T | null> {
  if (!obs.conn.availableRequests.has(type)) return null;
  return pick(await obs.request(type));
}

export async function status(obs: GuardedObs): Promise<ObsStatus> {
  return {
    obsVersion: obs.conn.obsVersion,
    wsVersion: obs.conn.wsVersion,
    currentScene: await optional(obs, "GetCurrentProgramScene", (r) => String(r.currentProgramSceneName ?? r.sceneName ?? "")),
    virtualCam: await optional(obs, "GetVirtualCamStatus", (r) => r.outputActive === true),
    recording: await optional(obs, "GetRecordStatus", (r) => r.outputActive === true),
    streaming: await optional(obs, "GetStreamStatus", (r) => r.outputActive === true),
  };
}

export async function sceneList(obs: GuardedObs): Promise<{ current: string | null; scenes: string[] }> {
  const r = await obs.request<{ currentProgramSceneName?: string; scenes?: Array<{ sceneName: string; sceneIndex?: number }> }>("GetSceneList");
  // OBS lists scenes bottom-up; present them top-down like the OBS UI.
  const scenes = [...(r.scenes ?? [])].sort((a, b) => (b.sceneIndex ?? 0) - (a.sceneIndex ?? 0)).map((s) => s.sceneName);
  return { current: r.currentProgramSceneName ?? null, scenes };
}

export async function sceneSwitch(obs: GuardedObs, sceneName: string): Promise<{ current: string }> {
  const { scenes } = await sceneList(obs);
  if (!scenes.includes(sceneName)) {
    throw new ObsError("not-found", `no scene named ${JSON.stringify(sceneName)}; available: ${scenes.join(", ") || "(none)"}`, { scenes });
  }
  await obs.request("SetCurrentProgramScene", { sceneName });
  return { current: sceneName };
}

export async function sceneCreate(obs: GuardedObs, sceneName: string): Promise<{ created: string }> {
  await obs.request("CreateScene", { sceneName });
  return { created: sceneName };
}

async function setOutput(obs: GuardedObs, statusType: string, start: string, stop: string, on: boolean): Promise<{ active: boolean; changed: boolean }> {
  const r = await obs.request<{ outputActive?: boolean }>(statusType);
  if ((r.outputActive === true) === on) return { active: on, changed: false };
  await obs.request(on ? start : stop);
  return { active: on, changed: true };
}

export const vcam = (obs: GuardedObs, on: boolean) => setOutput(obs, "GetVirtualCamStatus", "StartVirtualCam", "StopVirtualCam", on);
export const record = (obs: GuardedObs, on: boolean) => setOutput(obs, "GetRecordStatus", "StartRecord", "StopRecord", on);

export type OutputName = "stream" | "record" | "vcam";
const OUTPUTS: ReadonlyArray<[OutputName, string, string]> = [
  ["stream", "GetStreamStatus", "StopStream"],
  ["record", "GetRecordStatus", "StopRecord"],
  ["vcam", "GetVirtualCamStatus", "StopVirtualCam"],
];

/**
 * Stop every active stream/record/virtual-camera output, then poll until they
 * report inactive (`attempts` x `intervalMs`). OBS asks to confirm an exit
 * while any output runs, so `pi-obs stop` calls this before quitting.
 */
export async function stopOutputs(
  obs: GuardedObs,
  opts: { sleep: (ms: number) => Promise<void>; attempts?: number; intervalMs?: number },
): Promise<{ stopped: OutputName[]; stillActive: OutputName[] }> {
  const supported = OUTPUTS.filter(([, get]) => obs.conn.availableRequests.has(get));
  const isActive = async (get: string) => (await obs.request<{ outputActive?: boolean }>(get)).outputActive === true;
  const stopped: OutputName[] = [];
  for (const [name, get, stop] of supported) {
    if (!(await isActive(get))) continue;
    await obs.request(stop);
    stopped.push(name);
  }
  let stillActive: OutputName[] = [];
  for (let i = 0; i < (opts.attempts ?? 20); i++) {
    stillActive = [];
    for (const [name, get] of supported) if (stopped.includes(name) && (await isActive(get))) stillActive.push(name);
    if (stillActive.length === 0) break;
    await opts.sleep(opts.intervalMs ?? 250);
  }
  return { stopped, stillActive };
}

/** Set a custom RTMP target. `key` comes from stdin; it is never returned or logged. */
export async function streamTarget(obs: GuardedObs, server: string, key: string): Promise<{ server: string; keySet: boolean }> {
  await obs.request("SetStreamServiceSettings", {
    streamServiceType: "rtmp_custom",
    streamServiceSettings: { server, key, use_auth: false },
  });
  return { server, keySet: key.length > 0 };
}

export async function textSet(obs: GuardedObs, inputName: string, text: string): Promise<{ input: string }> {
  await obs.request("SetInputSettings", { inputName, inputSettings: { text }, overlay: true });
  return { input: inputName };
}

export const BGREMOVAL_KIND = "background_removal";

export async function filterKinds(obs: GuardedObs): Promise<Set<string>> {
  if (!obs.conn.availableRequests.has("GetSourceFilterKindList")) return new Set();
  const { sourceFilterKinds = [] } = await obs.request<{ sourceFilterKinds?: string[] }>("GetSourceFilterKindList");
  return new Set(sourceFilterKinds);
}

export async function filterAddBgremoval(obs: GuardedObs, sourceName: string): Promise<{ source: string; filter: string }> {
  if (!(await filterKinds(obs)).has(BGREMOVAL_KIND)) {
    throw new ObsError("not-found", "plugin-missing: the obs-backgroundremoval filter kind is not installed in this OBS", { status: "plugin-missing" });
  }
  await obs.request("CreateSourceFilter", { sourceName, filterName: "Background Removal", filterKind: BGREMOVAL_KIND, filterSettings: {} });
  return { source: sourceName, filter: "Background Removal" };
}

export interface ScreenshotOptions {
  format?: "jpg" | "png";
  width?: number;
}

/** `imageData` is a `data:image/<fmt>;base64,…` URL (OBS's own encoding). */
export async function screenshot(obs: GuardedObs, sourceName: string, opts: ScreenshotOptions = {}): Promise<{ source: string; imageData: string }> {
  const r = await obs.request<{ imageData?: string }>("GetSourceScreenshot", {
    sourceName,
    imageFormat: opts.format ?? "jpg",
    ...(opts.width ? { imageWidth: opts.width } : {}),
  });
  return { source: sourceName, imageData: String(r.imageData ?? "") };
}

/** Screenshot of the current program scene (panel preview, design D6). */
export async function programScreenshot(obs: GuardedObs, width = 640): Promise<{ source: string; imageData: string }> {
  const r = await obs.request<{ currentProgramSceneName?: string; sceneName?: string }>("GetCurrentProgramScene");
  const scene = String(r.currentProgramSceneName ?? r.sceneName ?? "");
  if (!scene) throw new ObsError("not-found", "OBS reports no program scene");
  return screenshot(obs, scene, { format: "jpg", width });
}
