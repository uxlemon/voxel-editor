/**
 * Sparse voxel grid for a single model.
 *
 * Coordinate convention (matches the .vox file format): integer cells indexed
 * (x, y, z) where +z is up. The renderer maps model-z to Three.js +y so models
 * stand upright. Color is a palette index 1..255; 0 means empty.
 */
export class VoxelModel {
  sizeX: number;
  sizeY: number;
  sizeZ: number;

  /** key = packed (x,y,z) -> palette index (1..255). Absent = empty. */
  private cells = new Map<number, number>();

  constructor(sizeX = 32, sizeY = 32, sizeZ = 32) {
    this.sizeX = sizeX;
    this.sizeY = sizeY;
    this.sizeZ = sizeZ;
  }

  /** Pack coords into a single integer key. Sizes are capped at 1024 by .vox. */
  private key(x: number, y: number, z: number): number {
    return (x & 0x3ff) | ((y & 0x3ff) << 10) | ((z & 0x3ff) << 20);
  }

  inBounds(x: number, y: number, z: number): boolean {
    return (
      x >= 0 &&
      y >= 0 &&
      z >= 0 &&
      x < this.sizeX &&
      y < this.sizeY &&
      z < this.sizeZ
    );
  }

  /** Palette index at a cell, or 0 if empty / out of bounds. */
  get(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return 0;
    return this.cells.get(this.key(x, y, z)) ?? 0;
  }

  /** Set a cell. colorIndex 0 removes the voxel. Out-of-bounds is ignored. */
  set(x: number, y: number, z: number, colorIndex: number): void {
    if (!this.inBounds(x, y, z)) return;
    const k = this.key(x, y, z);
    if (colorIndex <= 0) this.cells.delete(k);
    else this.cells.set(k, colorIndex & 0xff);
  }

  has(x: number, y: number, z: number): boolean {
    return this.get(x, y, z) !== 0;
  }

  get count(): number {
    return this.cells.size;
  }

  clear(): void {
    this.cells.clear();
  }

  /** Iterate over all solid voxels. */
  forEach(fn: (x: number, y: number, z: number, color: number) => void): void {
    for (const [k, color] of this.cells) {
      const x = k & 0x3ff;
      const y = (k >> 10) & 0x3ff;
      const z = (k >> 20) & 0x3ff;
      fn(x, y, z, color);
    }
  }

  /** Resize the grid; voxels outside the new bounds are dropped. */
  resize(sizeX: number, sizeY: number, sizeZ: number): void {
    this.sizeX = sizeX;
    this.sizeY = sizeY;
    this.sizeZ = sizeZ;
    for (const k of [...this.cells.keys()]) {
      const x = k & 0x3ff;
      const y = (k >> 10) & 0x3ff;
      const z = (k >> 20) & 0x3ff;
      if (!this.inBounds(x, y, z)) this.cells.delete(k);
    }
  }

  clone(): VoxelModel {
    const m = new VoxelModel(this.sizeX, this.sizeY, this.sizeZ);
    m.cells = new Map(this.cells);
    return m;
  }

  /** Raw access used by the .vox writer. */
  entries(): IterableIterator<[number, number]> {
    return this.cells.entries();
  }

  /** Full state snapshot (for structural undo when the volume grows). */
  snapshot(): VoxelSnapshot {
    return {
      data: [...this.cells],
      sizeX: this.sizeX,
      sizeY: this.sizeY,
      sizeZ: this.sizeZ,
    };
  }

  restore(s: VoxelSnapshot): void {
    this.sizeX = s.sizeX;
    this.sizeY = s.sizeY;
    this.sizeZ = s.sizeZ;
    this.cells = new Map(s.data);
  }

  /** Shift all voxels by (sx,sy,sz) and set a new size (used to grow bounds). */
  shiftResize(sx: number, sy: number, sz: number, nX: number, nY: number, nZ: number): void {
    const old = [...this.cells];
    this.cells.clear();
    this.sizeX = nX;
    this.sizeY = nY;
    this.sizeZ = nZ;
    for (const [k, color] of old) {
      const x = k & 0x3ff;
      const y = (k >> 10) & 0x3ff;
      const z = (k >> 20) & 0x3ff;
      this.set(x + sx, y + sy, z + sz, color);
    }
  }
}

export interface VoxelSnapshot {
  data: [number, number][];
  sizeX: number;
  sizeY: number;
  sizeZ: number;
}
