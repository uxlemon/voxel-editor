import * as THREE from "three";
import { Viewport } from "./Viewport";
import { VoxDocument, Placement } from "../core/Document";
import { buildVoxelGeometry } from "./mesher";
import { VolumeBox } from "./VolumeBox";

/**
 * Renders a whole VoxDocument: one mesh per placement, positioned by its
 * world translation, with the combined scene centered horizontally and resting
 * on the grid.
 *
 * Coordinate mapping. Geometry for a model is built in Three.js space where a
 * voxel (vx,vy,vz) (z up) occupies the unit box at (vx, vz, vy). A placement's
 * mesh is then translated to {@link positionFor}. The inverse — turning a
 * world-space point into model voxel coords — lives in {@link worldToVoxel}.
 */
export class SceneRenderer {
  readonly group = new THREE.Group();
  private material: THREE.MeshBasicMaterial;
  /** world(voxel)->three offset applied so the scene is centered on the grid. */
  offset = new THREE.Vector3();
  /** placement -> its mesh, for targeted rebuilds and hit mapping. */
  private meshes = new Map<Placement, THREE.Mesh>();
  private doc: VoxDocument | null = null;
  /** MagicaVoxel-style editable volume frame around the active model. */
  readonly volumeBox: VolumeBox;
  /** View options controlling visibility and the volume box. */
  view = {
    worldView: false, // "All" selected: show every object, read-only, no box
    showOthers: false, // while editing one object, also show the others
    cleanView: false, // hide the volume box for a clean presentation view
    gridShown: true, // gated by hover / active tool (see App)
  };

  /** 0 = pure white, 1 = full vertex color (used for the loading-reel fade). */
  private colorMix = 1;
  private colorMixShader: { uniforms: { uColorMix: { value: number } } } | null = null;

  constructor(private viewport: Viewport) {
    // Unlit material: shading + AO are baked into vertex colors so displayed
    // colors match the palette exactly. No scene lighting affects voxels.
    this.material = new THREE.MeshBasicMaterial({ vertexColors: true });
    // Inject a uniform that blends the voxel color toward white (loading state).
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uColorMix = { value: this.colorMix };
      shader.fragmentShader =
        "uniform float uColorMix;\n" +
        shader.fragmentShader.replace(
          "#include <color_fragment>",
          "#include <color_fragment>\n  diffuseColor.rgb = mix(vec3(1.0), diffuseColor.rgb, uColorMix);"
        );
      this.colorMixShader = shader as unknown as { uniforms: { uColorMix: { value: number } } };
    };
    this.viewport.content.add(this.group);
    this.volumeBox = new VolumeBox(this.viewport.content);
    this.viewport.addFrameCallback((cam) => this.volumeBox.updateVisibility(cam));
  }

  /** Blend voxel colors toward white (0) or full color (1). */
  setColorMix(v: number): void {
    this.colorMix = v;
    if (this.colorMixShader) this.colorMixShader.uniforms.uColorMix.value = v;
  }

  /** Position/size the volume box around the current active model. */
  private updateVolumeBox(doc: VoxDocument): void {
    const p = doc.placements.find((pl) => pl.modelId === doc.activeModel);
    const model = doc.models[doc.activeModel];
    if (!p || !model || this.view.worldView || this.view.cleanView || !this.view.gridShown) {
      this.volumeBox.setVisible(false);
      return;
    }
    this.volumeBox.build(model.sizeX, model.sizeY, model.sizeZ);
    this.volumeBox.setPosition(this.positionFor(p, model));
    this.volumeBox.setVisible(true);
  }

  /** Whether a placement's mesh should be visible under the current view. */
  private isVisible(doc: VoxDocument, p: Placement): boolean {
    if (this.view.worldView) return true;
    if (p.modelId === doc.activeModel) return true;
    return this.view.showOthers;
  }

  private disposeMeshes(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      (child as THREE.Mesh).geometry?.dispose();
    }
    this.meshes.clear();
  }

  /** Three.js position for a placement's mesh given current offset. */
  positionFor(p: Placement, model: { sizeX: number; sizeY: number; sizeZ: number }): THREE.Vector3 {
    const cornerX = p.t[0] - Math.floor(model.sizeX / 2);
    const cornerY = p.t[1] - Math.floor(model.sizeY / 2);
    const cornerZ = p.t[2] - Math.floor(model.sizeZ / 2);
    return new THREE.Vector3(
      cornerX + this.offset.x,
      cornerZ + this.offset.y,
      cornerY + this.offset.z
    );
  }

  /** Full rebuild of all meshes from the document. */
  sync(doc: VoxDocument): void {
    this.doc = doc;
    this.disposeMeshes();

    const b = doc.worldBounds();
    const ox = -(b.min[0] + b.max[0]) / 2;
    const ozy = -(b.min[1] + b.max[1]) / 2;
    const oyz = -b.min[2];
    this.offset.set(ox, oyz, ozy);

    for (const p of doc.placements) {
      const model = doc.models[p.modelId];
      if (!model) continue;
      const mesh = new THREE.Mesh(
        buildVoxelGeometry(model, doc.palette, { ao: true }),
        this.material
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.visible = this.isVisible(doc, p);
      mesh.position.copy(this.positionFor(p, model));
      mesh.userData.placement = p;
      this.group.add(mesh);
      this.meshes.set(p, mesh);
    }

    this.updateVolumeBox(doc);
  }

  /** Re-apply per-object visibility without rebuilding geometry. */
  applyVisibility(doc: VoxDocument): void {
    for (const [p, mesh] of this.meshes) mesh.visible = this.isVisible(doc, p);
    this.updateVolumeBox(doc);
  }

  /** Reposition/resize the volume box (after active-model or size changes). */
  syncVolumeBox(doc: VoxDocument): void {
    this.updateVolumeBox(doc);
  }

  /** Rebuild only the geometry of meshes referencing the given model index. */
  syncModel(modelId: number): void {
    if (!this.doc) return;
    for (const [p, mesh] of this.meshes) {
      if (p.modelId !== modelId) continue;
      const model = this.doc.models[p.modelId];
      mesh.geometry.dispose();
      mesh.geometry = buildVoxelGeometry(model, this.doc.palette, { ao: true });
    }
  }

  /** Refresh geometry (e.g. after a palette edit). */
  syncPalette(): void {
    if (!this.doc) return;
    for (const [p, mesh] of this.meshes) {
      const model = this.doc.models[p.modelId];
      mesh.geometry.dispose();
      mesh.geometry = buildVoxelGeometry(model, this.doc.palette, { ao: true });
    }
  }

  meshFor(p: Placement): THREE.Mesh | undefined {
    return this.meshes.get(p);
  }

  /** Reposition a single placement's mesh (e.g. during a world-view move). */
  repositionPlacement(p: Placement): void {
    const mesh = this.meshes.get(p);
    const model = this.doc?.models[p.modelId];
    if (mesh && model) mesh.position.copy(this.positionFor(p, model));
  }

  /** All voxel meshes, for raycasting. */
  get raycastTargets(): THREE.Object3D[] {
    return this.group.children;
  }

  frame(doc: VoxDocument): void {
    const b = doc.worldBounds();
    this.viewport.frameModel(
      b.max[0] - b.min[0],
      b.max[1] - b.min[1],
      b.max[2] - b.min[2]
    );
  }
}
