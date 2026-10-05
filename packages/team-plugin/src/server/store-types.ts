import type { Persona } from "./types.js";

/** Read side of the persona store used by the conversation service. */
export interface PersonaStore {
  get(key: string, uk: string): Persona | null;
  listShared(): Persona[];
  listPrivate(uk: string): Persona[];
}
