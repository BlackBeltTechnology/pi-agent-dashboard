import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";
import { noiseVolume, num } from "./util.js";

const VERT = [
  "in vec3 position; uniform mat4 modelMatrix, modelViewMatrix, projectionMatrix; uniform vec3 cameraPos;",
  "out vec3 vOrigin; out vec3 vDirection;",
  "void main(){ vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);",
  "  vOrigin = vec3(inverse(modelMatrix) * vec4(cameraPos, 1.0)).xyz; vDirection = position - vOrigin;",
  "  gl_Position = projectionMatrix * mvPosition; }",
].join("\n");

const FRAG = [
  "precision highp float; precision highp sampler3D;",
  "uniform mat4 modelViewMatrix, projectionMatrix; in vec3 vOrigin; in vec3 vDirection; out vec4 color;",
  "uniform vec3 base; uniform sampler3D map; uniform float threshold, range, opacity, steps, frame;",
  "vec2 hitBox(vec3 orig, vec3 dir){ const vec3 box_min = vec3(-0.5); const vec3 box_max = vec3(0.5);",
  "  vec3 inv_dir = 1.0 / dir; vec3 tmin_tmp = (box_min - orig) * inv_dir; vec3 tmax_tmp = (box_max - orig) * inv_dir;",
  "  vec3 tmin = min(tmin_tmp, tmax_tmp); vec3 tmax = max(tmin_tmp, tmax_tmp);",
  "  return vec2(max(tmin.x, max(tmin.y, tmin.z)), min(tmax.x, min(tmax.y, tmax.z))); }",
  "float sample1(vec3 p){ return texture(map, p).r; }",
  "float shading(vec3 coord){ float step = 0.01; return sample1(coord + vec3(-step)) - sample1(coord + vec3(step)); }",
  // Deterministic per-pixel dither: a hash of the fragment coordinate, NOT a random number.
  "float dither(vec2 co){ return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }",
  "void main(){ vec3 rayDir = normalize(vDirection); vec2 bounds = hitBox(vOrigin, rayDir); if (bounds.x > bounds.y) discard;",
  "  bounds.x = max(bounds.x, 0.0); vec3 p = vOrigin + bounds.x * rayDir; vec3 inc = 1.0 / abs(rayDir);",
  "  float delta = min(inc.x, min(inc.y, inc.z)) / steps; p += rayDir * dither(gl_FragCoord.xy) * delta;",
  "  vec4 ac = vec4(base, 0.0);",
  "  for (float t = bounds.x; t < bounds.y; t += delta) {",
  "    float d = sample1(p + 0.5); d = smoothstep(threshold - range, threshold + range, d) * opacity;",
  "    float col = shading(p + 0.5) * 3.0 + ((p.x + p.y) * 0.25) + 0.2;",
  "    ac.rgb += (1.0 - ac.a) * d * col; ac.a += (1.0 - ac.a) * d; if (ac.a >= 0.95) break; p += rayDir * delta; }",
  "  color = ac; if (color.a == 0.0) discard; }",
].join("\n");

/**
 * A raymarched noise cloud (three `webgl_volume_cloud`). The 3D texture is
 * seeded from `ctx.rng`; step count scales with the tier so `low` costs a
 * fraction of `high`. `userData.count` reports the steps for the tier test.
 */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const { THREE, palette, rng, quality } = ctx;
  const size = quality.particles >= 1500 ? 64 : quality.particles >= 900 ? 48 : 32;
  const steps = quality.particles >= 1500 ? 100 : quality.particles >= 900 ? 60 : 32;
  const tex = noiseVolume(THREE, rng, size, 0.07, 3);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      base: { value: new THREE.Color(palette.second) },
      map: { value: tex },
      cameraPos: { value: new THREE.Vector3() },
      threshold: { value: num(params, "threshold", 0.25) },
      opacity: { value: num(params, "opacity", 0.12) },
      range: { value: num(params, "range", 0.1) },
      steps: { value: steps },
      frame: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    transparent: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(num(params, "scale", 14));
  mesh.position.set(num(params, "x", -4), 1, -9);
  const drift = num(params, "drift", 1);
  const holder = new THREE.Group();
  holder.add(mesh);
  holder.userData.count = steps;
  const cam = new THREE.Vector3();
  mesh.onBeforeRender = (_r, _s, camera) => {
    mat.uniforms.cameraPos.value.copy(camera.getWorldPosition(cam));
  };
  return {
    object: holder,
    tick: (t) => {
      mesh.rotation.y = t * 0.03 * drift;
      mesh.rotation.x = Math.sin(t * 0.05 * drift) * 0.15;
      mat.uniforms.frame.value = t;
    },
    dispose: () => {
      tex.dispose();
      geo.dispose();
      mat.dispose();
    },
  };
};
