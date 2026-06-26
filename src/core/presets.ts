import { VoxDocument } from "./Document";
import { VoxelModel } from "./VoxelModel";
import { Palette, hexToRGBA } from "./palette";

/**
 * Preset starter library. Every preset is a single model at a uniform size so
 * the home preview frames consistently. On a fresh visit a random preset is
 * shown; refreshing picks a different one (handled by the caller). These are
 * generated procedurally so no extra assets are needed.
 */

export const PRESET_SIZE = 24;
const C = PRESET_SIZE / 2; // center

// A small curated working palette mapped onto indices 1..N. The rest of the
// 256-color palette stays as MagicaVoxel's default (Advanced mode can use it).
const WORKING: string[] = [
  "#ffffff", // 1 white
  "#e8453c", // 2 red
  "#f2a13b", // 3 orange
  "#f5d44a", // 4 yellow
  "#5bbf5a", // 5 green
  "#36b3a8", // 6 teal
  "#4a90e2", // 7 blue
  "#9b59b6", // 8 purple
  "#e87fb0", // 9 pink
  "#8a5a3b", // 10 brown
  "#3a3f4a", // 11 dark
  "#c8ccd4", // 12 light gray
];

function basePalette(): Palette {
  const pal = Palette.default();
  WORKING.forEach((hex, i) => pal.set(i + 1, hexToRGBA(hex, 255)));
  return pal;
}

function makeDoc(build: (m: VoxelModel) => void): VoxDocument {
  const model = new VoxelModel(PRESET_SIZE, PRESET_SIZE, PRESET_SIZE);
  build(model);
  return new VoxDocument({ palette: basePalette(), models: [model] });
}

function box(m: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number): void {
  for (let x = x0; x < x1; x++)
    for (let y = y0; y < y1; y++)
      for (let z = z0; z < z1; z++) m.set(x, y, z, c);
}

interface PresetDef {
  id: string;
  name: string;
  build: (m: VoxelModel) => void;
}

const PRESETS: PresetDef[] = [
  {
    id: "cube",
    name: "Cube",
    build: (m) => box(m, C - 6, C - 6, C - 6, C + 6, C + 6, C + 6, 7),
  },
  {
    id: "sphere",
    name: "Sphere",
    build: (m) => {
      const r = 9;
      for (let x = 0; x < PRESET_SIZE; x++)
        for (let y = 0; y < PRESET_SIZE; y++)
          for (let z = 0; z < PRESET_SIZE; z++) {
            const dx = x - C + 0.5, dy = y - C + 0.5, dz = z - C + 0.5;
            if (dx * dx + dy * dy + dz * dz <= r * r) m.set(x, y, z, 6);
          }
    },
  },
  {
    id: "pyramid",
    name: "Pyramid",
    build: (m) => {
      const h = 14;
      for (let z = 0; z < h; z++) {
        const half = Math.round((h - z) * 0.7);
        box(m, C - half, C - half, z, C + half, C + half, z + 1, 4);
      }
    },
  },
  {
    id: "diamond",
    name: "Gem",
    build: (m) => {
      const r = 10;
      for (let x = 0; x < PRESET_SIZE; x++)
        for (let y = 0; y < PRESET_SIZE; y++)
          for (let z = 0; z < PRESET_SIZE; z++) {
            const d = Math.abs(x - C + 0.5) + Math.abs(y - C + 0.5) + Math.abs(z - C + 0.5);
            if (d <= r) m.set(x, y, z, 8);
          }
    },
  },
  {
    id: "tree",
    name: "Tree",
    build: (m) => {
      box(m, C - 1, C - 1, 0, C + 1, C + 1, 9, 10); // trunk
      const r = 7;
      const cz = 14;
      for (let x = 0; x < PRESET_SIZE; x++)
        for (let y = 0; y < PRESET_SIZE; y++)
          for (let z = 9; z < PRESET_SIZE; z++) {
            const dx = x - C + 0.5, dy = y - C + 0.5, dz = z - cz;
            if (dx * dx + dy * dy + dz * dz <= r * r) m.set(x, y, z, 5);
          }
    },
  },
  {
    id: "house",
    name: "House",
    build: (m) => {
      box(m, C - 7, C - 7, 0, C + 7, C + 7, 10, 1); // walls
      box(m, C - 1, C - 7, 0, C + 2, C - 6, 6, 10); // door
      for (let z = 0; z < 8; z++) {
        const half = 8 - z;
        box(m, C - half, C - half, 10 + z, C + half, C + half, 11 + z, 2); // roof
      }
    },
  },
  {
    id: "heart",
    name: "Heart",
    build: (m) => {
      // implicit heart in the x-z plane, extruded along y
      for (let x = 0; x < PRESET_SIZE; x++)
        for (let z = 0; z < PRESET_SIZE; z++) {
          const nx = (x - C + 0.5) / 9;
          const nz = (z - C + 1.5) / 9;
          const v = Math.pow(nx * nx + nz * nz - 1, 3) - nx * nx * nz * nz * nz;
          if (v <= 0) box(m, x, C - 4, z, x + 1, C + 4, z + 1, 9);
        }
    },
  },
  {
    id: "robot",
    name: "Robot",
    build: (m) => {
      box(m, C - 5, C - 3, 0, C + 5, C + 3, 3, 11); // feet
      box(m, C - 4, C - 3, 3, C + 4, C + 3, 12, 12); // body
      box(m, C - 5, C - 1, 6, C - 4, C + 1, 11, 12); // arms
      box(m, C + 4, C - 1, 6, C + 5, C + 1, 11, 12);
      box(m, C - 4, C - 4, 12, C + 4, C + 4, 20, 1); // head
      box(m, C - 2, C - 4, 16, C - 1, C - 3, 17, 7); // eyes
      box(m, C + 1, C - 4, 16, C + 2, C - 3, 17, 7);
    },
  },
];

export function presetIds(): string[] {
  return PRESETS.map((p) => p.id);
}

/** Pick a random preset, avoiding `excludeId` when possible. */
export function pickRandomPreset(excludeId?: string): { id: string; name: string; doc: VoxDocument } {
  const pool = PRESETS.filter((p) => p.id !== excludeId);
  const list = pool.length ? pool : PRESETS;
  const p = list[Math.floor(Math.random() * list.length)];
  return { id: p.id, name: p.name, doc: makeDoc(p.build) };
}

/** Build a specific preset by id (falls back to the first). */
export function buildPreset(id: string): { id: string; name: string; doc: VoxDocument } {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0];
  return { id: p.id, name: p.name, doc: makeDoc(p.build) };
}
