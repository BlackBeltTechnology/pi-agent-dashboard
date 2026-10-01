import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";
import { countFor, num, softSprite, str } from "./util.js";

/**
 * The vertices of a solid as pulsing points (three `webgl_custom_attributes_points2`).
 * `geometry` = sphere | box | knot picks the host; per-vertex size and colour
 * are attributes, animated in the shader from `time` alone.
 */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const { THREE, palette, rng } = ctx;
  const target = countFor(ctx, 1, num(params, "density", 1), 200);
  const shape = str(params, "geometry", "sphere");
  const seg = Math.max(8, Math.round(Math.sqrt(target)));
  const host =
    shape === "box" ? new THREE.BoxGeometry(6, 6, 6, seg / 2, seg / 2, seg / 2) : shape === "knot" ? new THREE.TorusKnotGeometry(3, 1, seg * 4, seg) : new THREE.SphereGeometry(4, seg, seg);
  const pos = host.getAttribute("position");
  const count = pos.count;
  const sizes = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const a = new THREE.Color(palette.accent);
  const b = new THREE.Color(palette.second);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    sizes[i] = 0.2 + rng() * 0.18;
    c.copy(a).lerp(b, (i % 7) / 7);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", pos.clone());
  geo.setAttribute("baseSize", new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute("customColor", new THREE.BufferAttribute(colors, 3));
  const tex = softSprite(THREE, 32, 1.4);
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, time: { value: 0 }, pulse: { value: num(params, "pulse", 1) }, size: { value: num(params, "size", 1) } },
    vertexShader: [
      "attribute float baseSize; attribute vec3 customColor; uniform float time, pulse, size; varying vec3 vColor;",
      "void main(){ vColor = customColor; vec4 mv = modelViewMatrix * vec4(position, 1.0);",
      "  float s = baseSize * (1.0 + 0.6 * pulse * sin(time * 2.0 + position.x * 0.8 + position.y * 0.6));",
      "  gl_PointSize = s * size * (300.0 / -mv.z); gl_Position = projectionMatrix * mv; }",
    ].join("\n"),
    fragmentShader: [
      "uniform sampler2D map; varying vec3 vColor;",
      "void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vColor, t.a); }",
    ].join("\n"),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.position.set(num(params, "x", 4), 0, -6);
  const spin = num(params, "spin", 1);
  const holder = new THREE.Group();
  holder.add(points);
  holder.userData.count = count;
  host.dispose();
  return {
    object: holder,
    tick: (t) => {
      mat.uniforms.time.value = t;
      points.rotation.y = t * 0.1 * spin;
      points.rotation.z = Math.sin(t * 0.07) * 0.2;
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
};
