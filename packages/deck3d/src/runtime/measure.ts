/**
 * Screen-space projection used by `measure()` (and therefore by every `check`
 * fit/overlap/occlusion rule).
 *
 * The box is taken in the OBJECT'S OWN frame and then transformed, never as a
 * world-axis-aligned `Box3`. A world AABB inflates the moment a slide is turned
 * — on the `orbit`/`helix` rails every slide but the first is — which reported
 * titles up to 1.5x their real size and produced `fit` findings for layouts
 * that were correct. See change: deck3d-cinematic-worlds.
 */
import * as THREE from "three";

export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const localBox = new THREE.Box3();
const childBox = new THREE.Box3();
const toLocal = new THREE.Matrix4();
const childToLocal = new THREE.Matrix4();
const corner = new THREE.Vector3();

/** Union of the object's geometry bounds expressed in the object's own frame. */
function boundsInOwnFrame(object: THREE.Object3D): THREE.Box3 {
  object.updateWorldMatrix(true, true);
  toLocal.copy(object.matrixWorld).invert();
  localBox.makeEmpty();
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const geometry = mesh.geometry;
    if (!geometry) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox) return;
    childBox.copy(geometry.boundingBox);
    childToLocal.multiplyMatrices(toLocal, child.matrixWorld);
    childBox.applyMatrix4(childToLocal);
    localBox.union(childBox);
  });
  return localBox;
}

export function projectRect(
  object: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): ScreenRect | null {
  const box = boundsInOwnFrame(object);
  if (box.isEmpty()) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        // Local corner -> world (the object's own rotation included) -> screen.
        corner.set(x, y, z).applyMatrix4(object.matrixWorld).project(camera);
        const px = (corner.x * 0.5 + 0.5) * width;
        const py = (-corner.y * 0.5 + 0.5) * height;
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
      }
    }
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
