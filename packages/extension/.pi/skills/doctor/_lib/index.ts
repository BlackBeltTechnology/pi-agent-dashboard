/**
 * Doctor `_lib` barrel — the mechanical check helpers shared across capability
 * modules. Modules keep all KNOWLEDGE/FIX prose to themselves; only these
 * resolution/probe/label/hash primitives are shared (design.md D8, DRY rule).
 *
 * See change: add-modular-doctor-skill.
 */

export * from "./checks.js";
export * from "./front-matter.js";
export * from "./knowledge-hash.js";
export * from "./provenance.js";
export * from "./router.js";
export * from "./server-tier.js";
