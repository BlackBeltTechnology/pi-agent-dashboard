import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";
import { countFor, num, softSprite } from "./util.js";

/**
 * Shader-driven particle cloud with per-vertex size and colour (three
 * `webgl_buffergeometry_custom_attributes_particles`). Size pulses per
 * particle from `time` alone; nothing is integrated frame to frame.
 */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const { THREE, palette, rng } = ctx;
  const count = countFor(ctx, 0.5, num(params, "density", 1), 300);
  const radius = num(params, "radius", 12);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const a = new THREE.Color(palette.accent);
  const b = new THREE.Color(palette.second);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // Uniform in a sphere: cube-root radius, random direction.
    const r = radius * Math.cbrt(rng());
    const u = rng() * 2 - 1;
    const th = rng() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    positions[i * 3] = r * s * Math.cos(th);
    positions[i * 3 + 1] = r * s * Math.sin(th) * 0.5;
    positions[i * 3 + 2] = r * u * 0.6 - 6;
    c.copy(a).lerp(b, rng());
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
    sizes[i] = 0.2 + rng() * 0.5;
    phases[i] = rng() * 6.28;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("customColor", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute("phase", new THREE.BufferAttribute(phases, 1));
  const tex = softSprite(THREE, 32, 1.8);
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, time: { value: 0 }, sizeScale: { value: num(params, "size", 1) } },
    vertexShader: [
      "attribute float size; attribute float phase; attribute vec3 customColor; uniform float time, sizeScale; varying vec3 vColor;",
      "void main(){ vColor = customColor; vec4 mv = modelViewMatrix * vec4(position, 1.0);",
      "  float k = 1.0 + 0.5 * sin(time * 1.5 + phase);",
      "  gl_PointSize = size * sizeScale * k * (280.0 / -mv.z); gl_Position = projectionMatrix * mv; }",
    ].join("\n"),
    fragmentShader: [
      "uniform sampler2D map; varying vec3 vColor;",
      "void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vColor, t.a * 0.9); }",
    ].join("\n"),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  const spin = num(params, "spin", 1);
  const holder = new THREE.Group();
  holder.add(points);
  holder.userData.count = count;
  return {
    object: holder,
    tick: (t) => {
      mat.uniforms.time.value = t;
      points.rotation.y = t * 0.04 * spin;
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
};
