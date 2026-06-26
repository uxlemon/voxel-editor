import * as THREE from "three";
import { VoxDocument } from "../core/Document";
import { parseVox } from "../io/voxParser";
import { buildVoxelGeometry } from "./mesher";

/**
 * Renders a VoxDocument to a square PNG data URL using a private offscreen
 * renderer — independent of the live editor camera, so thumbnails look
 * consistent regardless of how the user has framed the scene. Reuses the same
 * baked-AO vertex-color geometry as the editor for a matching look.
 */
export class Thumbnailer {
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly size: number;

  constructor(size = 256) {
    this.size = size;
  }

  private getRenderer(): THREE.WebGLRenderer {
    if (this.renderer) return this.renderer;
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.setSize(this.size, this.size, false);
    r.setPixelRatio(1);
    r.setClearColor(0x000000, 0); // transparent — tiles sit on a light bg
    r.toneMapping = THREE.NoToneMapping;
    this.renderer = r;
    return r;
  }

  /** Render a document to a square PNG data URL, optionally from a given view
   *  direction (defaults to a pleasant iso angle). Always frames the whole
   *  model with margin, so nothing is cut. */
  render(doc: VoxDocument, viewDir?: THREE.Vector3): string {
    const renderer = this.getRenderer();
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ vertexColors: true });

    let min = new THREE.Vector3(Infinity, Infinity, Infinity);
    let max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

    for (const p of doc.placements) {
      const model = doc.models[p.modelId];
      if (!model || model.count === 0) continue;
      const geo = buildVoxelGeometry(model, doc.palette, { ao: true });
      const mesh = new THREE.Mesh(geo, material);
      // world(voxel z-up) corner -> three (x, z, y)
      const cx = p.t[0] - Math.floor(model.sizeX / 2);
      const cy = p.t[1] - Math.floor(model.sizeY / 2);
      const cz = p.t[2] - Math.floor(model.sizeZ / 2);
      mesh.position.set(cx, cz, cy);
      group.add(mesh);
      min.min(new THREE.Vector3(cx, cz, cy));
      max.max(new THREE.Vector3(cx + model.sizeX, cz + model.sizeZ, cy + model.sizeY));
    }
    scene.add(group);

    if (!isFinite(min.x)) {
      min = new THREE.Vector3(0, 0, 0);
      max = new THREE.Vector3(1, 1, 1);
    }
    const center = min.clone().add(max).multiplyScalar(0.5);
    const radius = Math.max(max.x - min.x, max.y - min.y, max.z - min.z) || 1;

    const cam = new THREE.PerspectiveCamera(40, 1, 0.1, radius * 20 + 100);
    const dir = (viewDir && viewDir.lengthSq() > 0 ? viewDir.clone() : new THREE.Vector3(0.8, 0.7, 1)).normalize();
    cam.position.copy(center).addScaledVector(dir, radius * 1.8 + 3); // tighter fill
    cam.lookAt(center);

    renderer.render(scene, cam);
    const url = renderer.domElement.toDataURL("image/png");

    // free per-render geometry
    group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    material.dispose();
    return url;
  }

  /** Convenience: parse .vox bytes then render. */
  renderVox(voxBytes: ArrayBuffer): string {
    return this.render(parseVox(voxBytes));
  }

  dispose(): void {
    this.renderer?.dispose();
    this.renderer = null;
  }
}
