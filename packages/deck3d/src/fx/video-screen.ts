// video-screen — a framed screen in the scene playing a looping clip. Licence: MIT.
//
// SPIKE (video layer). Three constraints shaped this:
//   1. The clip must be SAME-ORIGIN. A `file://` video taints the canvas and
//      then `texImage2D` throws, so the source is served by `deck3d serve`'s
//      asset route (or, later, an inlined `data:` URL under `--embed-video`).
//   2. The panel is UNLIT (`MeshBasicMaterial`): a screen recording must read
//      as its own pixels, not as a surface being lit by the rig's key light.
//   3. Playback is gated by `setActive` — frozen while the camera flies, and
//      started only once the slide settles, so a clip never plays off-screen.
import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";

export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const { THREE, palette } = ctx;
  const src = typeof params.src === "string" ? params.src : "";
  const width = typeof params.width === "number" ? params.width : 7;
  const x = typeof params.x === "number" ? params.x : 4.6;
  const y = typeof params.y === "number" ? params.y : 0.8;
  const z = typeof params.z === "number" ? params.z : -1.5;
  const tilt = typeof params.tilt === "number" ? params.tilt : -0.12;

  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = tilt;

  // 16:9 until the clip reports its real aspect, then corrected in `tick`.
  let aspect = 16 / 9;
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width / aspect),
    new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false }),
  );
  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(width * 1.04, (width / aspect) * 1.06, 0.14),
    new THREE.MeshStandardMaterial({ color: palette.second, metalness: 0.8, roughness: 0.35 }),
  );
  bezel.position.z = -0.09;
  bezel.castShadow = true;
  group.add(bezel, screen);

  let video: HTMLVideoElement | null = null;
  let texture: THREE.VideoTexture | null = null;
  let sized = false;
  let active = false;

  // The corpus gate runs without a DOM; a card must still construct there.
  if (src && typeof document !== "undefined") {
    video = document.createElement("video");
    video.src = src;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.load();
    texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    (screen.material as THREE.MeshBasicMaterial).map = texture;
    (screen.material as THREE.MeshBasicMaterial).color.set(0xffffff);
    (screen.material as THREE.MeshBasicMaterial).needsUpdate = true;
  }

  /** Re-fit the panel once the clip reports its real dimensions. */
  const fit = (): void => {
    if (sized || !video?.videoWidth) return;
    aspect = video.videoWidth / video.videoHeight;
    const h = width / aspect;
    screen.geometry.dispose();
    screen.geometry = new THREE.PlaneGeometry(width, h);
    bezel.geometry.dispose();
    bezel.geometry = new THREE.BoxGeometry(width * 1.04, h * 1.06, 0.14);
    sized = true;
  };

  return {
    object: group,
    tick: () => {
      fit();
      // A pinned time (`check`/`snapshot`) must show a stable frame, so the
      // clip is only ever running while the slide is settled.
      if (!video) return;
      if (active && video.paused) void video.play().catch(() => undefined);
      if (!active && !video.paused) video.pause();
    },
    setActive: (next: boolean) => {
      active = next;
      if (!video) return;
      if (!next) video.pause();
    },
    dispose: () => {
      video?.pause();
      texture?.dispose();
      screen.geometry.dispose();
      (screen.material as THREE.Material).dispose();
      bezel.geometry.dispose();
      (bezel.material as THREE.Material).dispose();
      if (video) video.src = "";
    },
  };
};
