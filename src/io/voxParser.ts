import { VoxelModel } from "../core/VoxelModel";
import { Palette, RGBA, DEFAULT_PALETTE_U32, u32ToRGBA } from "../core/palette";
import { VoxDocument, Placement, LayerInfo } from "../core/Document";

/**
 * Parser for the MagicaVoxel .vox format.
 *
 * Layout: "VOX " + int32 version, then a MAIN chunk whose children include
 * SIZE/XYZI pairs (one per model), an optional RGBA palette, optional MATL
 * materials, and the nTRN/nGRP/nSHP scene graph + LAYR layers. We read voxel
 * data, palette, layers, and per-model translation from the scene graph.
 *
 * Reference: https://github.com/ephtracy/voxel-model/blob/master/MagicaVoxel-file-format-vox.txt
 */

class Reader {
  private view: DataView;
  off = 0;
  constructor(buf: ArrayBuffer) {
    this.view = new DataView(buf);
  }
  get remaining(): number {
    return this.view.byteLength - this.off;
  }
  u8(): number {
    return this.view.getUint8(this.off++);
  }
  i32(): number {
    const v = this.view.getInt32(this.off, true);
    this.off += 4;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.off, true);
    this.off += 4;
    return v >>> 0;
  }
  fourcc(): string {
    const s = String.fromCharCode(
      this.view.getUint8(this.off),
      this.view.getUint8(this.off + 1),
      this.view.getUint8(this.off + 2),
      this.view.getUint8(this.off + 3)
    );
    this.off += 4;
    return s;
  }
  bytes(n: number): Uint8Array {
    const b = new Uint8Array(this.view.buffer, this.off, n);
    this.off += n;
    return b;
  }
  /** VOX STRING: int32 length + UTF-8 bytes. */
  str(): string {
    const n = this.i32();
    const b = this.bytes(n);
    return new TextDecoder().decode(b);
  }
  /** VOX DICT: int32 count, then count (key,value) string pairs. */
  dict(): Record<string, string> {
    const n = this.i32();
    const d: Record<string, string> = {};
    for (let i = 0; i < n; i++) {
      const k = this.str();
      d[k] = this.str();
    }
    return d;
  }
}

interface RawModel {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  voxels: Uint8Array; // n*4: x,y,z,colorIndex
}

interface TrnNode {
  childId: number;
  layerId: number;
  translation: [number, number, number];
  name?: string;
}
interface GrpNode {
  children: number[];
}
interface ShpNode {
  modelIds: number[];
}

export function parseVox(buf: ArrayBuffer): VoxDocument {
  const r = new Reader(buf);
  const magic = r.fourcc();
  if (magic !== "VOX ") {
    throw new Error(`Not a .vox file (magic "${magic}")`);
  }
  r.i32(); // version

  const main = r.fourcc();
  if (main !== "MAIN") throw new Error("Missing MAIN chunk");
  r.i32(); // MAIN content size (0)
  const childBytes = r.i32();
  const end = r.off + childBytes;

  const rawModels: RawModel[] = [];
  let pendingSize: { x: number; y: number; z: number } | null = null;
  let paletteColors: RGBA[] | null = null;

  const trn = new Map<number, TrnNode>();
  const grp = new Map<number, GrpNode>();
  const shp = new Map<number, ShpNode>();
  const layers = new Map<number, LayerInfo>();

  while (r.off < end && r.remaining >= 12) {
    const id = r.fourcc();
    const contentSize = r.i32();
    r.i32(); // childChunks size (unused at this level)
    const chunkEnd = r.off + contentSize;

    switch (id) {
      case "SIZE": {
        // .vox SIZE is (x, y, z) but axes vs our model: store as given.
        const x = r.u32();
        const y = r.u32();
        const z = r.u32();
        pendingSize = { x, y, z };
        break;
      }
      case "XYZI": {
        const n = r.u32();
        const voxels = r.bytes(n * 4).slice(); // copy out of the buffer view
        const s = pendingSize ?? { x: 32, y: 32, z: 32 };
        rawModels.push({ sizeX: s.x, sizeY: s.y, sizeZ: s.z, voxels });
        pendingSize = null;
        break;
      }
      case "RGBA": {
        const cols: RGBA[] = new Array(256);
        cols[0] = { r: 0, g: 0, b: 0, a: 0 };
        // chunk entry i maps to palette index i+1 (1..255); 256th entry unused
        const raw: RGBA[] = [];
        for (let i = 0; i < 256; i++) {
          raw.push({ r: r.u8(), g: r.u8(), b: r.u8(), a: r.u8() });
        }
        for (let i = 0; i <= 254; i++) cols[i + 1] = raw[i];
        cols[255] = cols[255] ?? raw[254];
        paletteColors = cols;
        break;
      }
      case "nTRN": {
        const nodeId = r.i32();
        r.dict(); // node attributes (may hold _name)
        const childId = r.i32();
        r.i32(); // reserved (-1)
        const layerId = r.i32();
        const numFrames = r.i32();
        let translation: [number, number, number] = [0, 0, 0];
        let name: string | undefined;
        for (let f = 0; f < numFrames; f++) {
          const frame = r.dict();
          if (frame._t) {
            const parts = frame._t.split(" ").map((s) => parseInt(s, 10));
            translation = [parts[0] || 0, parts[1] || 0, parts[2] || 0];
          }
        }
        trn.set(nodeId, { childId, layerId, translation, name });
        break;
      }
      case "nGRP": {
        const nodeId = r.i32();
        r.dict();
        const num = r.i32();
        const children: number[] = [];
        for (let i = 0; i < num; i++) children.push(r.i32());
        grp.set(nodeId, { children });
        break;
      }
      case "nSHP": {
        const nodeId = r.i32();
        r.dict();
        const num = r.i32();
        const modelIds: number[] = [];
        for (let i = 0; i < num; i++) {
          modelIds.push(r.i32());
          r.dict(); // per-model attributes
        }
        shp.set(nodeId, { modelIds });
        break;
      }
      case "LAYR": {
        const lid = r.i32();
        const attr = r.dict();
        r.i32(); // reserved (-1)
        layers.set(lid, {
          id: lid,
          name: attr._name || `layer ${lid}`,
          hidden: attr._hidden === "1",
        });
        break;
      }
      default:
        // MATL, rOBJ, rCAM, NOTE, IMAP, MnTR, etc. — skip content.
        break;
    }

    r.off = chunkEnd; // robust against partial reads / unknown chunks
  }

  // Build models.
  const models = rawModels.map((rm) => {
    const m = new VoxelModel(rm.sizeX, rm.sizeY, rm.sizeZ);
    const v = rm.voxels;
    for (let i = 0; i < v.length; i += 4) {
      m.set(v[i], v[i + 1], v[i + 2], v[i + 3]);
    }
    return m;
  });

  // Resolve placements from the scene graph (translation accumulates down the
  // tree). If there is no graph, place each model at the origin.
  const placements: Placement[] = [];
  if (trn.size > 0 && trn.has(0)) {
    const walk = (
      nodeId: number,
      tx: number,
      ty: number,
      tz: number,
      layerId: number
    ) => {
      const t = trn.get(nodeId);
      if (t) {
        const nx = tx + t.translation[0];
        const ny = ty + t.translation[1];
        const nz = tz + t.translation[2];
        const lid = t.layerId >= 0 ? t.layerId : layerId;
        walk(t.childId, nx, ny, nz, lid);
        return;
      }
      const g = grp.get(nodeId);
      if (g) {
        for (const c of g.children) walk(c, tx, ty, tz, layerId);
        return;
      }
      const s = shp.get(nodeId);
      if (s) {
        for (const mid of s.modelIds) {
          placements.push({ modelId: mid, t: [tx, ty, tz], layerId });
        }
      }
    };
    walk(0, 0, 0, 0, 0);
  }
  if (placements.length === 0) {
    models.forEach((_, i) =>
      placements.push({ modelId: i, t: [0, 0, 0], layerId: 0 })
    );
  }

  // Layers: use parsed list, else synthesize from placements.
  let layerList: LayerInfo[];
  if (layers.size > 0) {
    layerList = [...layers.values()].sort((a, b) => a.id - b.id);
  } else {
    const ids = new Set(placements.map((p) => p.layerId));
    layerList = [...ids].sort((a, b) => a - b).map((id) => ({
      id,
      name: `layer ${id}`,
      hidden: false,
    }));
  }
  if (layerList.length === 0)
    layerList = [{ id: 0, name: "layer 0", hidden: false }];

  const palette = paletteColors
    ? new Palette(paletteColors)
    : new Palette(DEFAULT_PALETTE_U32.map(u32ToRGBA));

  const doc = new VoxDocument({ palette, models, placements, layers: layerList });
  if (doc.models.length === 0) doc.models.push(new VoxelModel(32, 32, 32));
  return doc;
}
