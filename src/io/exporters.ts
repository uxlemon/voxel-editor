import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { VoxDocument } from "../core/Document";
import { Viewport } from "../render/Viewport";
import { rgbaToU32 } from "../core/palette";

/**
 * Mesh exporters. Voxel faces are emitted with hidden-face culling and grouped
 * by palette color into materials.
 *
 *  - OBJ + MTL: universally importable — Blender (File > Import > Wavefront) and
 *    Roblox Studio (MeshPart / bulk import) both read it, with per-color
 *    materials so colors survive.
 *  - glTF (.glb): best for Blender; single binary file, vertex colors baked.
 *  - PNG: a screenshot of the current view.
 *
 * Coordinate space: Y-up (model z -> y), matching the editor's display and what
 * Blender/Roblox expect after their standard import axis handling.
 */

type Cell = { x: number; y: number; z: number };

const FACE_DEFS: { dir: [number, number, number]; corners: [number, number, number][] }[] = [
  { dir: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { dir: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { dir: [0, 1, 0], corners: [[1, 1, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1]] },
  { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { dir: [0, 0, -1], corners: [[0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, 0]] },
];

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** World min corner (voxel coords) of a placement, matching the renderer. */
function placementCorner(doc: VoxDocument, p: { modelId: number; t: [number, number, number] }): Cell {
  const m = doc.models[p.modelId];
  return {
    x: p.t[0] - Math.floor(m.sizeX / 2),
    y: p.t[1] - Math.floor(m.sizeY / 2),
    z: p.t[2] - Math.floor(m.sizeZ / 2),
  };
}

/** Build OBJ + MTL text for all visible voxels, grouped by color. */
export function buildOBJ(doc: VoxDocument, name = "model"): { obj: string; mtl: string } {
  const objLines: string[] = [`# Voxel Editor export`, `mtllib ${name}.mtl`];
  let vIndex = 1;
  const usedColors = new Set<number>();
  // group faces by color so OBJ uses one material group per color
  const byColor = new Map<number, string[]>();

  for (const p of doc.placements) {
    const layer = doc.layers.find((l) => l.id === p.layerId);
    if (layer?.hidden) continue;
    const model = doc.models[p.modelId];
    const corner = placementCorner(doc, p);

    model.forEach((x, y, z, color) => {
      for (const f of FACE_DEFS) {
        if (model.get(x + f.dir[0], y + f.dir[1], z + f.dir[2]) !== 0) continue;
        const faceLines = byColor.get(color) ?? [];
        const idx: number[] = [];
        for (const [cx, cy, cz] of f.corners) {
          // world voxel coords -> Y-up (x, z, y)
          const wx = corner.x + x + cx;
          const wy = corner.y + y + cy;
          const wz = corner.z + z + cz;
          objLines.push(`v ${wx} ${wz} ${wy}`);
          idx.push(vIndex++);
        }
        faceLines.push(`f ${idx[0]} ${idx[1]} ${idx[2]} ${idx[3]}`);
        byColor.set(color, faceLines);
        usedColors.add(color);
      }
    });
  }

  for (const [color, faces] of byColor) {
    objLines.push(`usemtl color_${color}`);
    objLines.push(...faces);
  }

  const mtlLines: string[] = [`# Voxel Editor materials`];
  for (const color of usedColors) {
    const c = doc.palette.get(color);
    mtlLines.push(`newmtl color_${color}`);
    mtlLines.push(
      `Kd ${(c.r / 255).toFixed(4)} ${(c.g / 255).toFixed(4)} ${(c.b / 255).toFixed(4)}`
    );
    mtlLines.push(`Ka 0 0 0`, `Ks 0 0 0`, `d 1`, `illum 1`);
  }

  return { obj: objLines.join("\n"), mtl: mtlLines.join("\n") };
}

/** Download OBJ + MTL as two files (Blender + Roblox friendly). */
export function exportOBJ(doc: VoxDocument, name = "model"): void {
  const { obj, mtl } = buildOBJ(doc, name);
  download(new Blob([obj], { type: "text/plain" }), `${name}.obj`);
  download(new Blob([mtl], { type: "text/plain" }), `${name}.mtl`);
}

/** Build a binary glTF (.glb) ArrayBuffer from visible scene meshes. */
export async function buildGLB(group: THREE.Object3D): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter();
  const visible = new THREE.Group();
  // clone only visible meshes so hidden layers are excluded
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.visible) {
      const m = o as THREE.Mesh;
      const clone = new THREE.Mesh(
        m.geometry,
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })
      );
      clone.position.copy(m.position);
      visible.add(clone);
    }
  });
  return (await exporter.parseAsync(visible, { binary: true })) as ArrayBuffer;
}

/** Export the scene content as a binary glTF (.glb) — ideal for Blender. */
export async function exportGLB(group: THREE.Object3D, name = "model"): Promise<void> {
  const result = await buildGLB(group);
  download(new Blob([result], { type: "model/gltf-binary" }), `${name}.glb`);
}

/** Save a PNG screenshot of the current viewport render. */
export function exportPNG(viewport: Viewport, name = "render"): void {
  viewport.renderer.render(viewport.scene, viewport.camera);
  viewport.renderer.domElement.toBlob((blob) => {
    if (blob) download(blob, `${name}.png`);
  }, "image/png");
}

export { rgbaToU32 };
