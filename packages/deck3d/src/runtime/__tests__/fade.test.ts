import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createFader, fadeWindow } from "../fade.js";

const mesh = (m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(), m);

describe("slide cross-fade", () => {
  it("scales opacity, forces transparency, restores both at release", () => {
    const m = new THREE.MeshBasicMaterial({ opacity: 0.8 });
    const root = new THREE.Group().add(mesh(m));
    const f = createFader();
    f.apply(new Map([[root, 0.5]]));
    expect(m.opacity).toBeCloseTo(0.4);
    expect(m.transparent).toBe(true);
    f.apply(new Map([[root, 1]]));
    expect(m.opacity).toBeCloseTo(0.8);
    expect(m.transparent).toBe(false);
  });

  it("re-bases on an opacity the effect wrote itself", () => {
    const m = new THREE.MeshBasicMaterial({ opacity: 1 });
    const root = new THREE.Group().add(mesh(m));
    const f = createFader();
    f.apply(new Map([[root, 0.5]]));
    m.opacity = 0.6; // effect intro animates it
    f.apply(new Map([[root, 0.5]]));
    expect(m.opacity).toBeCloseTo(0.3);
    f.clear();
    expect(m.opacity).toBeCloseTo(0.6);
  });

  it("a shared material takes the larger weight; near zero hides the root", () => {
    const m = new THREE.MeshBasicMaterial();
    const a = new THREE.Group().add(mesh(m));
    const b = new THREE.Group().add(mesh(m));
    const f = createFader();
    f.apply(new Map([[a, 0.2], [b, 0.7]]));
    expect(m.opacity).toBeCloseTo(0.7);
    f.apply(new Map([[a, 0], [b, 0.7]]));
    expect(a.visible).toBe(false);
    f.clear();
    expect(a.visible).toBe(true);
    expect(m.opacity).toBe(1);
  });

  it("scales an opacity uniform on a shader material", () => {
    const m = new THREE.ShaderMaterial({ uniforms: { opacity: { value: 0.9 } } });
    const root = new THREE.Group().add(mesh(m));
    const f = createFader();
    f.apply(new Map([[root, 0.5]]));
    expect(m.uniforms.opacity.value).toBeCloseTo(0.45);
    f.clear();
    expect(m.uniforms.opacity.value).toBeCloseTo(0.9);
  });

  it("fadeWindow eases inside its window only", () => {
    expect(fadeWindow(0.1, 0.2, 0.6)).toBe(0);
    expect(fadeWindow(0.4, 0.2, 0.6)).toBeCloseTo(0.5);
    expect(fadeWindow(0.9, 0.2, 0.6)).toBe(1);
  });
});
