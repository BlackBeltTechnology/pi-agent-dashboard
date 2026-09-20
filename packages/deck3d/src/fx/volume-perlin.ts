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
  "uniform sampler3D map; uniform vec3 tint; uniform float threshold, steps;",
  "vec2 hitBox(vec3 orig, vec3 dir){ const vec3 box_min = vec3(-0.5); const vec3 box_max = vec3(0.5);",
  "  vec3 inv_dir = 1.0 / dir; vec3 tmin_tmp = (box_min - orig) * inv_dir; vec3 tmax_tmp = (box_max - orig) * inv_dir;",
  "  vec3 tmin = min(tmin_tmp, tmax_tmp); vec3 tmax = max(tmin_tmp, tmax_tmp);",
  "  return vec2(max(tmin.x, max(tmin.y, tmin.z)), min(tmax.x, min(tmax.y, tmax.z))); }",
  "float sample1(vec3 p){ return texture(map, p).r; }",
  "#define epsilon .0001",
  "vec3 normal(vec3 coord){ if (coord.x < epsilon) return vec3(1.0, 0.0, 0.0); if (coord.y < epsilon) return vec3(0.0, 1.0, 0.0); if (coord.z < epsilon) return vec3(0.0, 0.0, 1.0);",
  "  if (coord.x > 1.0 - epsilon) return vec3(-1.0, 0.0, 0.0); if (coord.y > 1.0 - epsilon) return vec3(0.0, -1.0, 0.0); if (coord.z > 1.0 - epsilon) return vec3(0.0, 0.0, -1.0);",
  "  float step = 0.01; float x = sample1(coord + vec3(-step, 0.0, 0.0)) - sample1(coord + vec3(step, 0.0, 0.0));",
  "  float y = sample1(coord + vec3(0.0, -step, 0.0)) - sample1(coord + vec3(0.0, step, 0.0));",
  "  float z = sample1(coord + vec3(0.0, 0.0, -step)) - sample1(coord + vec3(0.0, 0.0, step)); return normalize(vec3(x, y, z)); }",
  "void main(){ vec3 rayDir = normalize(vDirection); vec2 bounds = hitBox(vOrigin, rayDir); if (bounds.x > bounds.y) discard;",
  "  bounds.x = max(bounds.x, 0.0); vec3 p = vOrigin + bounds.x * rayDir; vec3 inc = 1.0 / abs(rayDir);",
  "  float delta = min(inc.x, min(inc.y, inc.z)) / steps;",
  "  for (float t = bounds.x; t < bounds.y; t += delta) { float d = sample1(p + 0.5);",
  "    if (d > threshold) { vec3 n = normal(p + 0.5); float l = 0.35 + 0.65 * max(0.0, dot(n, normalize(vec3(0.6, 0.8, 0.5))));",
  "      color = vec4(tint * l, 1.0); break; } p += rayDir * delta; }",
  "  if (color.a == 0.0) discard; }",
].join("\n");

/**
 * Raymarched isosurface of a seeded noise volume (three `webgl_volume_perlin`):
 * a slowly turning rock of light. Steps scale with the tier.
 */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const { THREE, palette, rng, quality } = ctx;
  const size = quality.particles >= 1500 ? 64 : quality.particles >= 900 ? 48 : 32;
  const steps = quality.particles >= 1500 ? 160 : quality.particles >= 900 ? 100 : 60;
  const tex = noiseVolume(THREE, rng, size, 0.05, 2);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      map: { value: tex },
      cameraPos: { value: new THREE.Vector3() },
      tint: { value: new THREE.Color(palette.accent) },
      threshold: { value: num(params, "threshold", 0.45) },
      steps: { value: steps },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(num(params, "scale", 9));
  mesh.position.set(num(params, "x", 5), 0, -7);
  const spin = num(params, "spin", 1);
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
      mesh.rotation.y = t * 0.08 * spin;
      mesh.rotation.x = Math.sin(t * 0.06 * spin) * 0.3;
    },
    dispose: () => {
      tex.dispose();
      geo.dispose();
      mat.dispose();
    },
  };
};
