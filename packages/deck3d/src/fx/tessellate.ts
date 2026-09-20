import { TessellateModifier } from "three/examples/jsm/modifiers/TessellateModifier.js";
import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";
import { countFor, num } from "./util.js";

/**
 * Tessellated solids whose faces breathe apart along their normals (three
 * `webgl_modifier_tessellation`). Per-face displacement and colour are seeded
 * once; the shader only reads `amplitude`, a function of `t`.
 */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const { THREE, palette, rng } = ctx;
  const count = countFor(ctx, 300, num(params, "density", 1), 2);
  const amp = num(params, "amplitude", 1);
  const detail = Math.max(1, Math.min(4, Math.round(num(params, "detail", 2))));

  let geo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1.4, 1);
  geo = new TessellateModifier(0.6, detail + 2).modify(geo);
  const n = geo.attributes.position.count;
  const displacement = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const a = new THREE.Color(palette.accent);
  const b = new THREE.Color(palette.second);
  const c = new THREE.Color();
  for (let f = 0; f < n; f += 3) {
    const d = (rng() - 0.5) * 2;
    c.copy(a).lerp(b, rng());
    for (let i = 0; i < 3; i++) {
      const k = (f + i) * 3;
      displacement[k] = displacement[k + 1] = displacement[k + 2] = d;
      colors[k] = c.r;
      colors[k + 1] = c.g;
      colors[k + 2] = c.b;
    }
  }
  geo.setAttribute("displacement", new THREE.BufferAttribute(displacement, 3));
  geo.setAttribute("customColor", new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.ShaderMaterial({
    uniforms: { amplitude: { value: 0 } },
    vertexShader: [
      "uniform float amplitude; attribute vec3 customColor; attribute vec3 displacement;",
      "varying vec3 vNormal; varying vec3 vColor;",
      "void main(){ vNormal = normal; vColor = customColor;",
      "  vec3 p = position + normal * amplitude * displacement;",
      "  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }",
    ].join("\n"),
    fragmentShader: [
      "varying vec3 vNormal; varying vec3 vColor;",
      "void main(){ const float ambient = 0.4; vec3 light = normalize(vec3(1.0, 1.0, 1.0));",
      "  float d = max(0.0, dot(normalize(vNormal), light));",
      "  gl_FragColor = vec4(vColor * (d + ambient), 1.0); }",
    ].join("\n"),
  });

  const group = new THREE.Group();
  const items: THREE.Mesh[] = [];
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set((rng() - 0.5) * 18, (rng() - 0.5) * 7, -(2 + rng() * 6));
    m.scale.setScalar(0.7 + rng() * 0.8);
    m.userData.phase = rng() * 6.28;
    group.add(m);
    items.push(m);
  }
  const holder = new THREE.Group();
  holder.add(group);
  holder.userData.count = count;
  return {
    object: holder,
    tick: (t) => {
      mat.uniforms.amplitude.value = 0.35 * amp * (1 + Math.sin(t * 0.9));
      for (const m of items) m.rotation.set(t * 0.15 + m.userData.phase, t * 0.25, 0);
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
};
