import { VoxelModel } from "./VoxelModel";
import { Palette } from "./palette";

/** A model placed in the world by its scene-graph translation. */
export interface Placement {
  /** index into {@link VoxDocument.models}. */
  modelId: number;
  /** world translation of the model center, in voxel units (x, y, z; z up). */
  t: [number, number, number];
  /** owning layer id, or -1. */
  layerId: number;
  /** optional shape/transform name. */
  name?: string;
}

export interface LayerInfo {
  id: number;
  name: string;
  hidden: boolean;
}

/**
 * In-memory representation of a .vox document: a shared 256-color palette, one
 * or more voxel models, and their placements in the world (from the nTRN/nGRP/
 * nSHP scene graph). A freshly created document has a single empty model.
 */
export class VoxDocument {
  palette: Palette;
  models: VoxelModel[];
  placements: Placement[];
  layers: LayerInfo[];
  /** index of the model currently being edited. */
  activeModel = 0;

  constructor(opts?: {
    palette?: Palette;
    models?: VoxelModel[];
    placements?: Placement[];
    layers?: LayerInfo[];
  }) {
    this.palette = opts?.palette ?? Palette.default();
    this.models = opts?.models ?? [new VoxelModel(32, 32, 32)];
    this.placements =
      opts?.placements ??
      this.models.map((_, i) => ({ modelId: i, t: [0, 0, 0], layerId: 0 }));
    this.layers = opts?.layers ?? [{ id: 0, name: "layer 0", hidden: false }];
  }

  static blank(size = 32): VoxDocument {
    return new VoxDocument({ models: [new VoxelModel(size, size, size)] });
  }

  /** A solid neutral-gray cube — the default starting creation. */
  static grayCube(size = 16): VoxDocument {
    const doc = new VoxDocument({ models: [new VoxelModel(size, size, size)] });
    const gray = doc.palette.closestIndex(124, 130, 140);
    const m = doc.active;
    for (let x = 0; x < size; x++)
      for (let y = 0; y < size; y++)
        for (let z = 0; z < size; z++) m.set(x, y, z, gray);
    return doc;
  }

  get active(): VoxelModel {
    return this.models[this.activeModel];
  }

  /** Combined world-space bounding box of all placed models (z-up voxel units). */
  worldBounds(): { min: [number, number, number]; max: [number, number, number] } {
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (const p of this.placements) {
      const m = this.models[p.modelId];
      if (!m) continue;
      // model min corner in world = center translation - floor(size/2)
      const ox = p.t[0] - Math.floor(m.sizeX / 2);
      const oy = p.t[1] - Math.floor(m.sizeY / 2);
      const oz = p.t[2] - Math.floor(m.sizeZ / 2);
      minX = Math.min(minX, ox);
      minY = Math.min(minY, oy);
      minZ = Math.min(minZ, oz);
      maxX = Math.max(maxX, ox + m.sizeX);
      maxY = Math.max(maxY, oy + m.sizeY);
      maxZ = Math.max(maxZ, oz + m.sizeZ);
    }
    if (!isFinite(minX)) {
      minX = minY = minZ = 0;
      maxX = maxY = maxZ = 1;
    }
    return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
  }
}
