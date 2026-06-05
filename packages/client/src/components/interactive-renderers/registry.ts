import type { InteractiveRenderer } from "./types.js";
import { ConfirmRenderer } from "./ConfirmRenderer.js";
import { SelectRenderer } from "./SelectRenderer.js";
import { InputRenderer } from "./InputRenderer.js";
import { EditorRenderer } from "./EditorRenderer.js";
import { MultiselectRenderer } from "./MultiselectRenderer.js";
import { NotifyRenderer } from "./NotifyRenderer.js";
import { BatchRenderer } from "./BatchRenderer.js";
import { GenericInteractiveRenderer } from "./GenericInteractiveRenderer.js";

const renderers = new Map<string, InteractiveRenderer>([
  ["confirm", ConfirmRenderer],
  ["select", SelectRenderer],
  ["input", InputRenderer],
  ["editor", EditorRenderer],
  ["multiselect", MultiselectRenderer],
  ["notify", NotifyRenderer],
  ["batch", BatchRenderer],
]);

/** Register a custom interactive renderer for a method */
export function registerInteractiveRenderer(method: string, renderer: InteractiveRenderer): void {
  renderers.set(method, renderer);
}

/** Get the renderer for an interactive UI method, falling back to GenericInteractiveRenderer */
export function getInteractiveRenderer(method: string): InteractiveRenderer {
  return renderers.get(method) ?? GenericInteractiveRenderer;
}
