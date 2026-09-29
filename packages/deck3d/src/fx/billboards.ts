import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";
import { countFor, num, softSprite } from "./util.js";

/**
 * Camera-facing instanced quads (three `webgl_buffergeometry_instancing_billboards`):
 * one draw call, per-instance offset + scale, the shader strips rotation so
 * every quad faces the view. Drift is `sin(t)`, no accumulated motion.
 */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const { THREE, palette, rng } = ctx;
  const count = countFor(ctx, 1, num(params, "density", 1), 100);
  const size = num(params, "size", 1);
  const tex = softSprite(THREE, 32, 2.2);

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, -0.5, 0], 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 1, 1, 0], 2));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  const offsets = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    offsets[i * 3] = (rng() - 0.5) * 30;
    offsets[i * 3 + 1] = (rng() - 0.5) * 12;
    offsets[i * 3 + 2] = -(1 + rng() * 14);
    scales[i] = (0.15 + rng() * 0.5) * size;
    phases[i] = rng() * 6.28;
  }
  geo.setAttribute("offset", new THREE.InstancedBufferAttribute(offsets, 3));
  geo.setAttribute("scale", new THREE.InstancedBufferAttribute(scales, 1));
  geo.setAttribute("phase", new THREE.InstancedBufferAttribute(phases, 1));

  const mat = new THREE.RawShaderMaterial({
    uniforms: { map: { value: tex }, time: { value: 0 }, tint: { value: new THREE.Color(palette.accent) }, tint2: { value: new THREE.Color(palette.second) } },
    vertexShader: [
      "precision highp float; uniform mat4 modelViewMatrix, projectionMatrix; uniform float time;",
      "attribute vec3 position; attribute vec2 uv; attribute vec3 offset; attribute float scale; attribute float phase;",
      "varying vec2 vUv; varying float vMix;",
      "void main(){ vUv = uv; vMix = 0.5 + 0.5 * sin(phase);",
      "  vec3 o = offset + vec3(sin(time * 0.3 + phase), cos(time * 0.2 + phase * 1.3), 0.0) * 0.6;",
      "  vec4 mv = modelViewMatrix * vec4(o, 1.0); mv.xy += position.xy * scale * (1.0 + 0.2 * sin(time + phase));",
      "  gl_Position = projectionMatrix * mv; }",
    ].join("\n"),
    fragmentShader: [
      "precision highp float; uniform sampler2D map; uniform vec3 tint, tint2; varying vec2 vUv; varying float vMix;",
      "void main(){ vec4 t = texture2D(map, vUv); gl_FragColor = vec4(mix(tint, tint2, vMix), t.a * 0.8); }",
    ].join("\n"),
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const holder = new THREE.Group();
  holder.add(mesh);
  holder.userData.count = count;
  return {
    object: holder,
    tick: (t) => {
      mat.uniforms.time.value = t;
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
};
