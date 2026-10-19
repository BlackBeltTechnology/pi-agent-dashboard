/**
 * Stateful scene-collection model behind the fake obs-websocket server:
 * scenes, inputs (name → kind + settings), scene items, filters, outputs.
 * Mirrors OBS semantics the presets rely on: `CreateInput` with a taken name →
 * 601; `CreateScene` with a taken name → 601. See change: add-obs-studio-plugin.
 */
import { err, type Handler } from "./fake-obs.js";

export interface ObsModel {
  scenes: Map<string, string[]>;
  inputs: Map<string, { kind: string; settings: Record<string, unknown> }>;
  filters: Map<string, string[]>;
  filterKinds: string[];
  outputs: { stream: boolean; record: boolean; vcam: boolean };
  /** Base (canvas) resolution reported by `GetVideoSettings`. */
  canvas: { width: number; height: number };
  /** Outputs whose `Stop*` request is accepted but leaves them active. */
  stuckOutputs: Array<"stream" | "record" | "vcam">;
  cameraItems: Array<{ itemName: string; itemValue: string }>;
  /** Make `GetInputPropertiesListPropertyItems` throw. */
  listingThrows?: boolean;
  handlers: Record<string, Handler>;
}

export function obsModel(init: Partial<Pick<ObsModel, "filterKinds" | "cameraItems">> = {}): ObsModel {
  const m: ObsModel = {
    scenes: new Map(),
    inputs: new Map(),
    filters: new Map(),
    filterKinds: init.filterKinds ?? ["chroma_key_filter_v2", "background_removal"],
    outputs: { stream: false, record: false, vcam: false },
    canvas: { width: 1920, height: 1080 },
    stuckOutputs: [],
    cameraItems: init.cameraItems ?? [
      { itemName: "MacBook Pro Camera", itemValue: "cam-1" },
      { itemName: "OBS Virtual Camera", itemValue: "obs-vcam" },
    ],
    handlers: {},
  };
  let nextItem = 1;
  m.handlers = {
    GetSceneList: () => ({
      currentProgramSceneName: [...m.scenes.keys()][0] ?? "",
      scenes: [...m.scenes.keys()].map((sceneName, i) => ({ sceneName, sceneIndex: i })),
    }),
    GetCurrentProgramScene: () => ({ currentProgramSceneName: [...m.scenes.keys()][0] ?? "" }),
    CreateScene: (d) => {
      const n = String(d.sceneName);
      if (m.scenes.has(n)) return err(601, "scene exists");
      m.scenes.set(n, []);
      return {};
    },
    RemoveScene: (d) => {
      m.scenes.delete(String(d.sceneName));
      return {};
    },
    GetSceneItemList: (d) => ({ sceneItems: (m.scenes.get(String(d.sceneName)) ?? []).map((sourceName) => ({ sourceName })) }),
    GetInputList: (d) => ({
      inputs: [...m.inputs]
        .filter(([, v]) => !d.inputKind || v.kind === d.inputKind)
        .map(([inputName, v]) => ({ inputName, inputUuid: `uuid-${inputName}`, inputKind: v.kind, unversionedInputKind: v.kind })),
    }),
    CreateInput: (d) => {
      const n = String(d.inputName);
      if (m.inputs.has(n)) return err(601, "A source already exists by that input name.");
      m.inputs.set(n, { kind: String(d.inputKind), settings: { ...(d.inputSettings as object) } });
      m.scenes.get(String(d.sceneName))?.push(n);
      return { sceneItemId: nextItem++ };
    },
    CreateSceneItem: (d) => {
      m.scenes.get(String(d.sceneName))?.push(String(d.sourceName));
      return { sceneItemId: nextItem++ };
    },
    RemoveInput: (d) => {
      const n = String(d.inputName);
      m.inputs.delete(n);
      for (const items of m.scenes.values()) {
        const i = items.indexOf(n);
        if (i >= 0) items.splice(i, 1);
      }
      return {};
    },
    SetSceneItemTransform: () => ({}),
    SetInputSettings: (d) => {
      const i = m.inputs.get(String(d.inputName));
      if (i) Object.assign(i.settings, d.inputSettings);
      return {};
    },
    GetInputPropertiesListPropertyItems: () => {
      if (m.listingThrows) return err(600, "listing failed");
      return { propertyItems: m.cameraItems };
    },
    GetSourceFilterKindList: () => ({ sourceFilterKinds: m.filterKinds }),
    CreateSourceFilter: (d) => {
      const s = String(d.sourceName);
      m.filters.set(s, [...(m.filters.get(s) ?? []), String(d.filterName)]);
      return {};
    },
    GetStreamStatus: () => ({ outputActive: m.outputs.stream }),
    GetRecordStatus: () => ({ outputActive: m.outputs.record }),
    GetVirtualCamStatus: () => ({ outputActive: m.outputs.vcam }),
    GetVideoSettings: () => ({ baseWidth: m.canvas.width, baseHeight: m.canvas.height, outputWidth: m.canvas.width, outputHeight: m.canvas.height }),
    StopStream: () => ((m.outputs.stream = m.stuckOutputs.includes("stream")), {}),
    StopRecord: () => ((m.outputs.record = m.stuckOutputs.includes("record")), {}),
    StopVirtualCam: () => ((m.outputs.vcam = m.stuckOutputs.includes("vcam")), {}),
  };
  return m;
}
