import * as THREE from "three";
import { VoxelModel } from "../core/VoxelModel";
import { Palette } from "../core/palette";

/**
 * Builds a single merged BufferGeometry for a voxel model, emitting only faces
 * exposed to empty space (interior faces are culled). Per-vertex colors come
 * from the palette so one MeshStandardMaterial renders the whole model.
 *
 * Axis mapping: model (x, y, z) with +z up  ->  Three.js (x, z, y) with +y up.
 * The geometry is built in this mapped space; callers center it via the mesh
 * transform.
 */

// 6 face directions in MODEL space (dx, dy, dz) and the 4 corner offsets of the
// quad on that face, wound CCW when viewed from outside.
interface Face {
  dir: [number, number, number];
  // corners in model space, each [x,y,z] offset from the voxel's min corner
  corners: [number, number, number][];
}

const FACES: Face[] = [
  // +X
  {
    dir: [1, 0, 0],
    corners: [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
  },
  // -X
  {
    dir: [-1, 0, 0],
    corners: [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
      [0, 0, 0],
    ],
  },
  // +Y
  {
    dir: [0, 1, 0],
    corners: [
      [1, 1, 0],
      [0, 1, 0],
      [0, 1, 1],
      [1, 1, 1],
    ],
  },
  // -Y
  {
    dir: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
  // +Z (up)
  {
    dir: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  // -Z (down)
  {
    dir: [0, 0, -1],
    corners: [
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
      [0, 0, 0],
    ],
  },
];

/** Map a model-space point to Three.js space (z-up -> y-up). */
function toThree(x: number, y: number, z: number): [number, number, number] {
  return [x, z, y];
}

/** Brightness multipliers for the 4 ambient-occlusion levels (0=darkest). */
const AO_LEVELS = [0.6, 0.76, 0.89, 1.0];

/** Fixed per-face shading by three-space normal (top brightest), baked into
 *  vertex colors so the look is consistent and palette-accurate (unlit). */
function faceShade(nx: number, ny: number, nz: number): number {
  if (ny > 0.5) return 1.0; // top
  if (ny < -0.5) return 0.6; // bottom
  if (nx > 0.5 || nz > 0.5) return 0.86; // +x / +z sides
  return 0.74; // -x / -z sides
}

/** sRGB (0..1) -> linear (0..1). Vertex colors must be linear so that, under
 *  neutral lighting, the displayed color matches the sRGB palette swatch. */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export interface MeshOptions {
  /** Bake per-vertex ambient occlusion into vertex colors. */
  ao?: boolean;
}

/**
 * Ambient-occlusion brightness for a face corner. Samples the three voxels that
 * meet at the corner on the air side of the face (the two in-plane edge
 * neighbors and the diagonal). Classic voxel AO.
 */
function cornerAO(
  model: VoxelModel,
  x: number,
  y: number,
  z: number,
  dir: [number, number, number],
  corner: [number, number, number]
): number {
  const ax = x + dir[0];
  const ay = y + dir[1];
  const az = z + dir[2];
  // in-plane axes are those where dir == 0; side direction from corner offset
  const axes: Array<[number, number, number]> = [];
  if (dir[0] === 0) axes.push([corner[0] === 1 ? 1 : -1, 0, 0]);
  if (dir[1] === 0) axes.push([0, corner[1] === 1 ? 1 : -1, 0]);
  if (dir[2] === 0) axes.push([0, 0, corner[2] === 1 ? 1 : -1]);
  const [u, v] = axes;
  const s1 = model.get(ax + u[0], ay + u[1], az + u[2]) !== 0 ? 1 : 0;
  const s2 = model.get(ax + v[0], ay + v[1], az + v[2]) !== 0 ? 1 : 0;
  const cor =
    model.get(ax + u[0] + v[0], ay + u[1] + v[1], az + u[2] + v[2]) !== 0 ? 1 : 0;
  const level = s1 && s2 ? 0 : 3 - (s1 + s2 + cor);
  return AO_LEVELS[level];
}

export function buildVoxelGeometry(
  model: VoxelModel,
  palette: Palette,
  options: MeshOptions = {}
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let vCount = 0;
  const ao = options.ao ?? false;

  // precompute a linear-space RGB lookup (three.js treats vertex colors as
  // linear, so convert sRGB palette -> linear for accurate displayed color).
  const lin = new Float32Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const c = palette.get(i);
    lin[i * 3] = srgbToLinear(c.r / 255);
    lin[i * 3 + 1] = srgbToLinear(c.g / 255);
    lin[i * 3 + 2] = srgbToLinear(c.b / 255);
  }

  model.forEach((x, y, z, colorIdx) => {
    const r = lin[colorIdx * 3];
    const g = lin[colorIdx * 3 + 1];
    const b = lin[colorIdx * 3 + 2];

    for (const face of FACES) {
      const [dx, dy, dz] = face.dir;
      // skip face if neighbor in that direction is solid
      if (model.get(x + dx, y + dy, z + dz) !== 0) continue;

      const [nx, ny, nz] = toThree(dx, dy, dz);
      const shade = faceShade(nx, ny, nz);
      const base = vCount;
      for (const corner of face.corners) {
        const [cx, cy, cz] = corner;
        const [px, py, pz] = toThree(x + cx, y + cy, z + cz);
        positions.push(px, py, pz);
        normals.push(nx, ny, nz);
        const k = (ao ? cornerAO(model, x, y, z, face.dir, corner) : 1) * shade;
        colors.push(r * k, g * k, b * k);
        vCount++;
      }
      // two triangles, wound so the geometric normal points outward (matches
      // the shading normal). Correct winding is required for FrontSide
      // back-face culling AND for raycasting to hit the outward face.
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}

/** Convenience: build a ready-to-add mesh, centered over the origin on the grid. */
export function buildVoxelMesh(
  model: VoxelModel,
  palette: Palette,
  options: MeshOptions = {}
): THREE.Mesh {
  const geo = buildVoxelGeometry(model, palette, options);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.0,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // center footprint over origin, base on grid (y=0)
  mesh.position.set(-model.sizeX / 2, 0, -model.sizeY / 2);
  return mesh;
}
