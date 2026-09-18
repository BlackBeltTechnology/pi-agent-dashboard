/** PBR material presets (glass / metal / matte), mode- and env-aware. */
import * as THREE from "three";
import type { PaletteColors } from "./palette.js";
import type { SlideConfig } from "./types.js";

export type MaterialRole = "accent" | "second";

function glassMaterial(col: string, role: MaterialRole, envOn: boolean): THREE.Material {
  if (role === "accent") {
    return new THREE.MeshPhysicalMaterial({
      color: col,
      metalness: 0.9,
      roughness: 0.18,
      envMapIntensity: envOn ? 1.4 : 0,
      emissive: col,
      emissiveIntensity: 0.25,
    });
  }
  return new THREE.MeshPhysicalMaterial({
    color: col,
    metalness: 0,
    roughness: 0.05,
    transmission: 0.85,
    thickness: 0.8,
    ior: 1.45,
    envMapIntensity: envOn ? 1.2 : 0,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });
}

export function diagramMaterial(P: PaletteColors, role: MaterialRole, cfg: SlideConfig): THREE.Material {
  const col = role === "accent" ? P.accent : P.second;
  const envOn = cfg.envReflections !== false;
  const material = cfg.material ?? "glass";
  if (material === "glass") return glassMaterial(col, role, envOn);
  if (material === "metal") {
    return new THREE.MeshStandardMaterial({
      color: col,
      metalness: 1,
      roughness: role === "accent" ? 0.22 : 0.38,
      envMapIntensity: envOn ? 1.6 : 0,
    });
  }
  return new THREE.MeshStandardMaterial({ color: col, metalness: 0.1, roughness: 0.75 });
}

export function titleMaterial(P: PaletteColors, cfg: SlideConfig): THREE.Material {
  return new THREE.MeshPhysicalMaterial({
    color: P.accent,
    metalness: 0.85,
    roughness: 0.2,
    envMapIntensity: cfg.envReflections !== false ? 1.5 : 0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.15,
    emissive: P.accent,
    emissiveIntensity: cfg.mode === "dark" ? 0.05 : 0,
  });
}
