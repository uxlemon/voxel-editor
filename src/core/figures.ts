import { VoxDocument } from "./Document";
import { VoxelModel } from "./VoxelModel";
import { Palette, hexToRGBA } from "./palette";

/**
 * Procedurally-generated community seed creations — small voxel figures and
 * animals, all at the same uniform dimensions (20³). Colors map to the NEAREST
 * entry in MagicaVoxel's default palette (so they reference the same palette
 * the knight uses) rather than overriding palette slots.
 */

export const FIG = { X: 20, Y: 20, Z: 20 };
const cx = FIG.X / 2;
const cy = FIG.Y / 2;

const DPAL = Palette.default();
/** nearest default-palette index for a hex color (cached) */
const cache = new Map<string, number>();
function idx(hex: string): number {
  const hit = cache.get(hex);
  if (hit) return hit;
  const t = hexToRGBA(hex);
  let best = 1;
  let bd = Infinity;
  for (let i = 1; i < 256; i++) {
    const c = DPAL.get(i);
    const d = (c.r - t.r) ** 2 + (c.g - t.g) ** 2 + (c.b - t.b) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  cache.set(hex, best);
  return best;
}

const C = {
  white: () => idx("#ffffff"),
  ltgray: () => idx("#cccccc"),
  gray: () => idx("#888888"),
  dkgray: () => idx("#555555"),
  black: () => idx("#222222"),
  red: () => idx("#ff3333"),
  orange: () => idx("#ff8a33"),
  dkorange: () => idx("#cc6622"),
  yellow: () => idx("#ffdd33"),
  green: () => idx("#55cc44"),
  dkgreen: () => idx("#2e8b57"),
  teal: () => idx("#33ccaa"),
  blue: () => idx("#4499ff"),
  navy: () => idx("#3355cc"),
  purple: () => idx("#9955dd"),
  pink: () => idx("#ff77bb"),
  brown: () => idx("#885533"),
  dkbrown: () => idx("#552e11"),
  tan: () => idx("#cc9966"),
  skin: () => idx("#ffcc99"),
  cream: () => idx("#f5e8c8"),
};

function box(m: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number): void {
  for (let x = x0; x < x1; x++)
    for (let y = y0; y < y1; y++)
      for (let z = z0; z < z1; z++) m.set(x, y, z, c);
}

function ball(m: VoxelModel, ox: number, oy: number, oz: number, rx: number, ry: number, rz: number, c: number): void {
  for (let x = Math.floor(ox - rx); x <= ox + rx; x++)
    for (let y = Math.floor(oy - ry); y <= oy + ry; y++)
      for (let z = Math.floor(oz - rz); z <= oz + rz; z++) {
        const dx = (x - ox) / rx, dy = (y - oy) / ry, dz = (z - oz) / rz;
        if (dx * dx + dy * dy + dz * dz <= 1.04) m.set(x, y, z, c);
      }
}
/** put a single voxel (clamped) */
function v(m: VoxelModel, x: number, y: number, z: number, c: number): void {
  m.set(x, y, z, c);
}
/** white sclera + dark pupil at a face cell */
function eye(m: VoxelModel, x: number, y: number, z: number): void {
  v(m, x, y, z, C.white());
  v(m, x, y - 1, z, C.black());
}

interface FigureDef {
  id: string;
  name: string;
  author: string;
  build: (m: VoxelModel) => void;
}

const FIGURES: FigureDef[] = [
  {
    id: "fig-cat", name: "Cat", author: "mona",
    build: (m) => {
      const o = C.orange(), d = C.dkorange();
      ball(m, cx, cy + 1, 6, 4, 5, 4, o);                 // body
      // tabby stripes
      box(m, cx - 4, cy - 1, 8, cx + 4, cy + 1, 9, d);
      box(m, cx - 4, cy + 2, 7, cx + 4, cy + 4, 8, d);
      ball(m, cx, cy - 4, 11, 3.5, 3.5, 3.5, o);          // head
      v(m, cx - 3, cy - 6, 14, o); v(m, cx - 2, cy - 6, 15, o); // ears
      v(m, cx + 2, cy - 6, 15, o); v(m, cx + 3, cy - 6, 14, o);
      v(m, cx - 2, cy - 6, 14, C.pink()); v(m, cx + 2, cy - 6, 14, C.pink());
      eye(m, cx - 2, cy - 7, 11); eye(m, cx + 2, cy - 7, 11);
      v(m, cx, cy - 7, 10, C.pink());                     // nose
      box(m, cx - 1, cy + 5, 6, cx + 1, cy + 8, 13, o);   // tail
      // legs
      for (const lx of [cx - 3, cx + 1]) for (const ly of [cy - 2, cy + 2]) box(m, lx, ly, 0, lx + 2, ly + 2, 3, o);
    },
  },
  {
    id: "fig-bird", name: "Birdie", author: "kai",
    build: (m) => {
      const y = C.yellow();
      ball(m, cx, cy, 8, 4, 4, 5, y);                     // body
      ball(m, cx, cy - 1, 14, 3, 3, 3, y);                // head
      v(m, cx, cy - 5, 14, C.orange()); v(m, cx, cy - 4, 14, C.orange()); // beak
      eye(m, cx - 2, cy - 4, 15); eye(m, cx + 2, cy - 4, 15);
      box(m, cx - 5, cy - 1, 6, cx - 4, cy + 3, 12, C.orange());  // wings
      box(m, cx + 4, cy - 1, 6, cx + 5, cy + 3, 12, C.orange());
      box(m, cx - 2, cy + 4, 5, cx + 2, cy + 6, 9, C.dkorange()); // tail
      v(m, cx - 2, cy, 0, C.orange()); v(m, cx - 2, cy, 1, C.orange()); // legs
      v(m, cx + 1, cy, 0, C.orange()); v(m, cx + 1, cy, 1, C.orange());
    },
  },
  {
    id: "fig-robot", name: "Bot", author: "circuit",
    build: (m) => {
      const g = C.gray(), d = C.dkgray();
      box(m, cx - 3, cy - 2, 0, cx - 1, cy + 2, 3, d);    // feet
      box(m, cx + 1, cy - 2, 0, cx + 3, cy + 2, 3, d);
      box(m, cx - 4, cy - 3, 3, cx + 4, cy + 3, 12, g);   // body
      box(m, cx - 2, cy - 4, 5, cx + 2, cy - 3, 10, C.navy()); // chest panel
      v(m, cx - 1, cy - 4, 8, C.green()); v(m, cx + 1, cy - 4, 6, C.red());   // buttons
      box(m, cx - 6, cy - 1, 6, cx - 4, cy + 1, 8, d);    // arms
      box(m, cx + 4, cy - 1, 6, cx + 6, cy + 1, 8, d);
      box(m, cx - 3, cy - 3, 12, cx + 3, cy + 3, 18, C.ltgray()); // head
      v(m, cx - 2, cy - 4, 15, C.blue()); v(m, cx + 2, cy - 4, 15, C.blue()); // eyes
      box(m, cx - 1, cy - 4, 13, cx + 1, cy - 3, 14, d);  // mouth
      v(m, cx, cy, 18, g); v(m, cx, cy, 19, C.red());     // antenna
    },
  },
  {
    id: "fig-bunny", name: "Bun", author: "pip",
    build: (m) => {
      const w = C.white();
      ball(m, cx, cy + 1, 6, 4, 4, 5, w);                 // body
      ball(m, cx, cy - 3, 11, 3, 3, 3, w);                // head
      box(m, cx - 2, cy - 4, 13, cx - 1, cy - 3, 19, w);  // ears
      box(m, cx + 1, cy - 4, 13, cx + 2, cy - 3, 19, w);
      v(m, cx - 2, cy - 5, 15, C.pink()); v(m, cx - 2, cy - 5, 16, C.pink());
      v(m, cx + 1, cy - 5, 15, C.pink()); v(m, cx + 1, cy - 5, 16, C.pink());
      eye(m, cx - 2, cy - 6, 11); eye(m, cx + 2, cy - 6, 11);
      v(m, cx, cy - 6, 10, C.pink());                     // nose
      ball(m, cx, cy + 5, 5, 2, 2, 2, C.ltgray());        // tail
      box(m, cx - 2, cy - 2, 0, cx - 1, cy + 1, 2, w); box(m, cx + 1, cy - 2, 0, cx + 2, cy + 1, 2, w);
    },
  },
  {
    id: "fig-fish", name: "Fish", author: "splash",
    build: (m) => {
      const b = C.blue(), t = C.teal();
      ball(m, cx + 1, cy, 10, 5, 3, 4, b);                // body
      box(m, cx - 6, cy - 1, 8, cx - 3, cy + 1, 13, t);   // tail
      box(m, cx, cy, 14, cx + 3, cy + 1, 16, t);          // top fin
      box(m, cx, cy, 5, cx + 3, cy + 1, 7, t);            // bottom fin
      // stripes
      box(m, cx + 2, cy - 3, 7, cx + 3, cy + 3, 13, C.navy());
      eye(m, cx + 5, cy - 2, 11);                         // eye (side)
    },
  },
  {
    id: "fig-bear", name: "Bear", author: "honey",
    build: (m) => {
      const br = C.brown(), d = C.dkbrown();
      ball(m, cx, cy + 1, 7, 5, 5, 5, br);                // body
      box(m, cx - 2, cy - 4, 5, cx + 2, cy - 3, 10, C.tan()); // belly
      ball(m, cx, cy - 4, 13, 4, 4, 4, br);               // head
      ball(m, cx - 4, cy - 5, 16, 1.6, 1.6, 1.6, br); ball(m, cx + 4, cy - 5, 16, 1.6, 1.6, 1.6, br); // ears
      ball(m, cx, cy - 7, 12, 2, 1.6, 1.6, C.tan());      // snout
      v(m, cx, cy - 8, 12, C.black());                    // nose
      eye(m, cx - 2, cy - 7, 14); eye(m, cx + 2, cy - 7, 14);
      box(m, cx - 4, cy - 2, 0, cx - 1, cy + 2, 3, d); box(m, cx + 1, cy - 2, 0, cx + 4, cy + 2, 3, d); // legs
    },
  },
  {
    id: "fig-penguin", name: "Pengu", author: "frost",
    build: (m) => {
      const k = C.black();
      ball(m, cx, cy, 8, 4, 4, 7, k);                     // body
      box(m, cx - 2, cy - 4, 4, cx + 3, cy - 3, 13, C.white()); // belly
      ball(m, cx, cy, 16, 3, 3, 3, k);                    // head
      v(m, cx, cy - 4, 16, C.orange()); v(m, cx, cy - 4, 15, C.orange()); // beak
      eye(m, cx - 2, cy - 3, 17); eye(m, cx + 2, cy - 3, 17);
      box(m, cx - 4, cy - 1, 8, cx - 3, cy + 1, 13, k); box(m, cx + 3, cy - 1, 8, cx + 4, cy + 1, 13, k); // flippers
      box(m, cx - 3, cy - 5, 0, cx - 1, cy - 3, 1, C.orange()); box(m, cx + 1, cy - 5, 0, cx + 3, cy - 3, 1, C.orange()); // feet
    },
  },
  {
    id: "fig-dog", name: "Pup", author: "rex",
    build: (m) => {
      const t = C.tan(), d = C.brown();
      ball(m, cx, cy + 1, 6, 4, 5, 4, t);                 // body
      box(m, cx - 3, cy + 1, 7, cx, cy + 4, 10, d);       // patch
      ball(m, cx, cy - 5, 8, 3, 3, 3, t);                 // head
      box(m, cx - 4, cy - 5, 7, cx - 3, cy - 2, 11, d);   // floppy ears
      box(m, cx + 3, cy - 5, 7, cx + 4, cy - 2, 11, d);
      box(m, cx - 1, cy - 8, 6, cx + 1, cy - 6, 8, C.ltgray()); // snout
      v(m, cx, cy - 9, 7, C.black());                     // nose
      eye(m, cx - 2, cy - 7, 9); eye(m, cx + 2, cy - 7, 9);
      box(m, cx - 1, cy + 5, 6, cx, cy + 7, 11, t);       // tail
      for (const lx of [cx - 3, cx + 1]) for (const ly of [cy - 2, cy + 2]) box(m, lx, ly, 0, lx + 2, ly + 2, 3, t);
    },
  },
  {
    id: "fig-fox", name: "Fox", author: "vix",
    build: (m) => {
      const o = C.orange();
      ball(m, cx, cy + 1, 6, 4, 5, 4, o);
      box(m, cx - 2, cy - 4, 5, cx + 2, cy - 3, 9, C.white()); // chest
      ball(m, cx, cy - 5, 10, 3, 3, 3, o);
      box(m, cx - 3, cy - 6, 13, cx - 1, cy - 5, 16, o); box(m, cx + 1, cy - 6, 13, cx + 3, cy - 5, 16, o); // ears
      box(m, cx - 1, cy - 8, 9, cx + 1, cy - 6, 10, C.white()); v(m, cx, cy - 9, 9, C.black());
      eye(m, cx - 2, cy - 8, 11); eye(m, cx + 2, cy - 8, 11);
      box(m, cx - 2, cy + 5, 5, cx + 2, cy + 9, 9, o); box(m, cx - 2, cy + 8, 7, cx + 2, cy + 9, 9, C.white()); // tail
    },
  },
  {
    id: "fig-frog", name: "Frog", author: "ribbit",
    build: (m) => {
      const g = C.green();
      ball(m, cx, cy, 5, 5, 5, 4, g);
      ball(m, cx - 3, cy - 3, 9, 1.8, 1.8, 1.8, g); ball(m, cx + 3, cy - 3, 9, 1.8, 1.8, 1.8, g); // eye bumps
      eye(m, cx - 3, cy - 4, 9); eye(m, cx + 3, cy - 4, 9);
      box(m, cx - 5, cy - 5, 0, cx - 2, cy - 3, 2, g); box(m, cx + 2, cy - 5, 0, cx + 5, cy - 3, 2, g); // feet
      box(m, cx - 3, cy - 6, 3, cx + 3, cy - 5, 4, C.dkbrown()); // mouth
    },
  },
  {
    id: "fig-owl", name: "Owl", author: "hoot",
    build: (m) => {
      const br = C.brown();
      ball(m, cx, cy, 8, 4, 4, 6, br);
      box(m, cx - 3, cy - 4, 11, cx - 1, cy - 3, 13, C.tan()); box(m, cx + 1, cy - 4, 11, cx + 3, cy - 3, 13, C.tan());
      eye(m, cx - 2, cy - 4, 12); eye(m, cx + 2, cy - 4, 12);
      v(m, cx, cy - 4, 11, C.orange()); // beak
      box(m, cx - 4, cy - 3, 14, cx - 3, cy - 1, 16, br); box(m, cx + 3, cy - 3, 14, cx + 4, cy - 1, 16, br); // ear tufts
      box(m, cx - 5, cy - 1, 5, cx - 4, cy + 2, 11, br); box(m, cx + 4, cy - 1, 5, cx + 5, cy + 2, 11, br); // wings
    },
  },
  {
    id: "fig-pig", name: "Pig", author: "oink",
    build: (m) => {
      const p = C.pink();
      ball(m, cx, cy + 1, 6, 4, 5, 4, p);
      ball(m, cx, cy - 5, 8, 3, 3, 3, p);
      box(m, cx - 1, cy - 8, 7, cx + 1, cy - 6, 9, idx("#e06b9a")); // snout
      v(m, cx - 1, cy - 8, 8, C.dkbrown()); v(m, cx + 1, cy - 8, 8, C.dkbrown());
      eye(m, cx - 2, cy - 7, 9); eye(m, cx + 2, cy - 7, 9);
      box(m, cx - 2, cy - 6, 11, cx - 1, cy - 5, 12, p); box(m, cx + 1, cy - 6, 11, cx + 2, cy - 5, 12, p); // ears
      for (const lx of [cx - 3, cx + 1]) for (const ly of [cy - 2, cy + 2]) box(m, lx, ly, 0, lx + 2, ly + 2, 3, p);
    },
  },
  {
    id: "fig-sheep", name: "Sheep", author: "baa",
    build: (m) => {
      ball(m, cx, cy + 1, 7, 5, 5, 4, C.white());
      ball(m, cx, cy - 5, 9, 2.5, 2.5, 3, C.dkgray()); // head
      eye(m, cx - 1, cy - 7, 10); eye(m, cx + 1, cy - 7, 10);
      box(m, cx - 3, cy - 6, 11, cx - 2, cy - 5, 12, C.dkgray()); box(m, cx + 2, cy - 6, 11, cx + 3, cy - 5, 12, C.dkgray());
      for (const lx of [cx - 3, cx + 1]) for (const ly of [cy - 2, cy + 2]) box(m, lx, ly, 0, lx + 2, ly + 2, 4, C.dkgray());
    },
  },
  {
    id: "fig-mouse", name: "Mouse", author: "squeak",
    build: (m) => {
      const g = C.gray();
      ball(m, cx, cy + 1, 5, 3.5, 4.5, 3.5, g);
      ball(m, cx, cy - 4, 7, 2.5, 2.5, 2.5, g);
      ball(m, cx - 3, cy - 4, 10, 2, 1, 2, C.pink()); ball(m, cx + 3, cy - 4, 10, 2, 1, 2, C.pink()); // big ears
      eye(m, cx - 1, cy - 6, 7); eye(m, cx + 1, cy - 6, 7);
      v(m, cx, cy - 6, 6, C.pink());
      box(m, cx, cy + 5, 4, cx + 1, cy + 9, 5, C.pink()); // tail
    },
  },
  {
    id: "fig-duck", name: "Duck", author: "quack",
    build: (m) => {
      const y = C.yellow();
      ball(m, cx, cy + 1, 5, 4, 5, 3, y);
      ball(m, cx, cy - 4, 9, 2.8, 2.8, 2.8, y);
      box(m, cx - 1, cy - 7, 8, cx + 1, cy - 5, 9, C.orange()); // bill
      eye(m, cx - 2, cy - 5, 10); eye(m, cx + 2, cy - 5, 10);
      box(m, cx - 1, cy - 2, 0, cx + 2, cy, 1, C.orange()); // feet
    },
  },
  {
    id: "fig-turtle", name: "Turtle", author: "shelly",
    build: (m) => {
      ball(m, cx, cy, 6, 5, 5, 3, C.green());   // shell
      box(m, cx - 3, cy - 3, 7, cx + 3, cy + 3, 9, C.dkbrown()); // shell top pattern
      ball(m, cx, cy - 5, 5, 2, 2, 2, C.teal()); // head
      eye(m, cx - 1, cy - 6, 6); eye(m, cx + 1, cy - 6, 6);
      box(m, cx - 5, cy - 3, 2, cx - 3, cy - 1, 4, C.teal()); box(m, cx + 3, cy - 3, 2, cx + 5, cy - 1, 4, C.teal()); // front legs
      box(m, cx - 5, cy + 1, 2, cx - 3, cy + 3, 4, C.teal()); box(m, cx + 3, cy + 1, 2, cx + 5, cy + 3, 4, C.teal());
    },
  },
  {
    id: "fig-ghost", name: "Ghost", author: "boo",
    build: (m) => {
      const w = C.white();
      ball(m, cx, cy, 13, 4, 4, 4, w);     // head
      box(m, cx - 4, cy - 4, 5, cx + 4, cy + 4, 13, w); // body
      // wavy bottom
      for (let x = cx - 4; x < cx + 4; x += 2) box(m, x, cy - 4, 3, x + 1, cy + 4, 5, w);
      eye(m, cx - 2, cy - 4, 13); eye(m, cx + 2, cy - 4, 13);
    },
  },
  {
    id: "fig-alien", name: "Alien", author: "zorp",
    build: (m) => {
      const g = idx("#7ed957");
      box(m, cx - 2, cy - 2, 0, cx + 2, cy + 2, 6, g);  // body
      ball(m, cx, cy, 10, 4, 3, 4, g);                  // big head
      eye(m, cx - 2, cy - 3, 10); eye(m, cx + 2, cy - 3, 10);
      box(m, cx, cy, 14, cx + 1, cy + 1, 17, g); v(m, cx, cy, 17, C.red()); // antenna
      box(m, cx - 4, cy - 1, 3, cx - 3, cy + 1, 6, g); box(m, cx + 3, cy - 1, 3, cx + 4, cy + 1, 6, g); // arms
    },
  },
  {
    id: "fig-mushroom", name: "Shroom", author: "spore",
    build: (m) => {
      box(m, cx - 2, cy - 2, 0, cx + 2, cy + 2, 8, C.tan()); // stem
      ball(m, cx, cy, 9, 6, 6, 4, C.red());                  // cap
      v(m, cx - 3, cy - 2, 11, C.white()); v(m, cx + 3, cy + 1, 11, C.white()); v(m, cx, cy + 3, 10, C.white()); v(m, cx - 4, cy + 2, 9, C.white()); // dots
      eye(m, cx - 2, cy - 5, 5); eye(m, cx + 2, cy - 5, 5);
    },
  },
  {
    id: "fig-snowman", name: "Snowman", author: "frosty",
    build: (m) => {
      const w = C.white();
      ball(m, cx, cy, 4, 4, 4, 4, w);    // bottom
      ball(m, cx, cy, 10, 3, 3, 3, w);   // middle
      ball(m, cx, cy, 15, 2.4, 2.4, 2.4, w); // head
      v(m, cx, cy - 3, 15, C.orange()); // nose
      eye(m, cx - 1, cy - 3, 16); eye(m, cx + 1, cy - 3, 16);
      v(m, cx, cy, 10, C.black()); v(m, cx, cy, 8, C.black()); // buttons
      box(m, cx - 3, cy - 3, 17, cx + 3, cy + 3, 18, C.black()); // hat brim
      box(m, cx - 2, cy - 2, 18, cx + 2, cy + 2, 20, C.black());
    },
  },
  {
    id: "fig-octopus", name: "Octo", author: "inky",
    build: (m) => {
      const p = C.purple();
      ball(m, cx, cy, 11, 4, 4, 4, p);  // head
      eye(m, cx - 2, cy - 4, 12); eye(m, cx + 2, cy - 4, 12);
      for (const ax of [-4, -2, 0, 2]) { box(m, cx + ax, cy - 3, 0, cx + ax + 1, cy - 2, 8, p); box(m, cx + ax, cy + 2, 0, cx + ax + 1, cy + 3, 8, p); } // tentacles
    },
  },
  {
    id: "fig-crab", name: "Crab", author: "pinch",
    build: (m) => {
      const r = C.red();
      ball(m, cx, cy, 4, 5, 4, 2, r);  // body
      eye(m, cx - 2, cy - 3, 6); eye(m, cx + 2, cy - 3, 6);
      box(m, cx - 7, cy - 3, 3, cx - 5, cy - 1, 6, r); box(m, cx + 5, cy - 3, 3, cx + 7, cy - 1, 6, r); // claws
      for (const ax of [-6, 6]) box(m, cx + (ax > 0 ? 5 : -6), cy + 1, 0, cx + (ax > 0 ? 7 : -4), cy + 3, 2, r); // legs
    },
  },
  {
    id: "fig-panda", name: "Panda", author: "bao",
    build: (m) => {
      const w = C.white(), k = C.black();
      ball(m, cx, cy + 1, 6, 4, 5, 4, w);
      ball(m, cx, cy - 4, 11, 3.5, 3.5, 3.5, w);
      ball(m, cx - 4, cy - 5, 14, 1.6, 1.6, 1.6, k); ball(m, cx + 4, cy - 5, 14, 1.6, 1.6, 1.6, k); // ears
      box(m, cx - 3, cy - 7, 11, cx - 1, cy - 6, 13, k); box(m, cx + 1, cy - 7, 11, cx + 3, cy - 6, 13, k); // eye patches
      eye(m, cx - 2, cy - 7, 12); eye(m, cx + 2, cy - 7, 12);
      box(m, cx - 4, cy - 1, 4, cx - 3, cy + 2, 9, k); box(m, cx + 3, cy - 1, 4, cx + 4, cy + 2, 9, k); // arms
      box(m, cx - 3, cy - 2, 0, cx - 1, cy + 2, 3, k); box(m, cx + 1, cy - 2, 0, cx + 3, cy + 2, 3, k);
    },
  },
  {
    id: "fig-dino", name: "Dino", author: "rexy",
    build: (m) => {
      const g = idx("#5fae4f");
      box(m, cx - 3, cy - 1, 0, cx + 1, cy + 3, 9, g);  // body upright
      ball(m, cx - 1, cy - 3, 12, 3, 3, 3, g);          // head
      eye(m, cx - 3, cy - 5, 13); eye(m, cx + 1, cy - 5, 13);
      box(m, cx - 3, cy - 6, 11, cx + 1, cy - 5, 12, C.white()); // teeth
      box(m, cx + 1, cy, 4, cx + 6, cy + 2, 6, g);      // tail
      box(m, cx - 3, cy, 0, cx - 1, cy + 2, 3, g); box(m, cx, cy, 0, cx + 1, cy + 2, 3, g); // legs
      for (let z = 4; z < 11; z += 2) v(m, cx - 1, cy + 3, z, idx("#e0b84a")); // back spikes
    },
  },
  {
    id: "fig-cow", name: "Cow", author: "moo",
    build: (m) => {
      const w = C.white(), k = C.black();
      ball(m, cx, cy + 1, 6, 4, 5, 4, w);
      box(m, cx - 3, cy + 1, 8, cx - 1, cy + 4, 10, k); box(m, cx + 1, cy - 1, 7, cx + 3, cy + 1, 9, k); // spots
      ball(m, cx, cy - 5, 8, 3, 3, 3, w);
      box(m, cx - 1, cy - 8, 6, cx + 1, cy - 6, 8, C.pink()); // muzzle
      eye(m, cx - 2, cy - 7, 9); eye(m, cx + 2, cy - 7, 9);
      v(m, cx - 3, cy - 6, 11, k); v(m, cx + 3, cy - 6, 11, k); // horns/ears
      for (const lx of [cx - 3, cx + 1]) for (const ly of [cy - 2, cy + 2]) box(m, lx, ly, 0, lx + 2, ly + 2, 3, k);
    },
  },
  {
    id: "fig-whale", name: "Whale", author: "splash2",
    build: (m) => {
      const b = idx("#4a90e2");
      ball(m, cx, cy, 8, 6, 4, 4, b);   // body
      box(m, cx - 2, cy - 4, 4, cx + 2, cy - 3, 8, C.white()); // belly-ish
      box(m, cx - 8, cy - 1, 8, cx - 5, cy + 1, 13, b); // tail
      eye(m, cx + 5, cy - 2, 9);
      box(m, cx + 2, cy, 12, cx + 3, cy + 1, 14, idx("#bfe0ff")); // spout
    },
  },
  {
    id: "fig-bee", name: "Bee", author: "buzz",
    build: (m) => {
      const y = C.yellow(), k = C.black();
      ball(m, cx, cy, 8, 3.5, 5, 3.5, y);
      box(m, cx - 4, cy - 1, 5, cx + 4, cy + 1, 11, k); box(m, cx - 4, cy + 2, 5, cx + 4, cy + 4, 11, k); // stripes
      eye(m, cx - 2, cy - 4, 9); eye(m, cx + 2, cy - 4, 9);
      box(m, cx - 5, cy, 11, cx - 2, cy + 2, 13, C.white()); box(m, cx + 2, cy, 11, cx + 5, cy + 2, 13, C.white()); // wings
    },
  },
  {
    id: "fig-ladybug", name: "Ladybug", author: "dot",
    build: (m) => {
      const r = C.red(), k = C.black();
      ball(m, cx, cy, 5, 5, 5, 3, r);
      box(m, cx, cy - 5, 4, cx + 1, cy + 5, 8, k); // center line
      ball(m, cx, cy - 5, 6, 2, 2, 2, k); // head
      v(m, cx - 2, cy - 1, 8, k); v(m, cx + 2, cy + 1, 8, k); v(m, cx - 2, cy + 2, 7, k); v(m, cx + 2, cy - 2, 7, k); // dots
    },
  },
  {
    id: "fig-monkey", name: "Monkey", author: "banana",
    build: (m) => {
      const br = C.brown(), t = C.tan();
      ball(m, cx, cy + 1, 6, 3.5, 4.5, 3.5, br);
      ball(m, cx, cy - 4, 10, 3, 3, 3, br);
      box(m, cx - 2, cy - 5, 9, cx + 2, cy - 4, 12, t); // face
      ball(m, cx - 4, cy - 4, 11, 1.5, 1.5, 1.5, br); ball(m, cx + 4, cy - 4, 11, 1.5, 1.5, 1.5, br); // ears
      eye(m, cx - 1, cy - 6, 10); eye(m, cx + 1, cy - 6, 10);
      box(m, cx + 1, cy + 5, 5, cx + 2, cy + 9, 10, br); // tail
      for (const lx of [cx - 3, cx + 1]) box(m, lx, cy - 1, 0, lx + 2, cy + 1, 3, br);
    },
  },
  {
    id: "fig-robot2", name: "Mech", author: "gizmo",
    build: (m) => {
      const g = C.dkgray(), s = C.ltgray();
      box(m, cx - 4, cy - 3, 0, cx + 4, cy + 3, 9, g);   // chunky body
      box(m, cx - 3, cy - 4, 2, cx + 3, cy - 3, 7, idx("#ffcf3a")); // panel
      box(m, cx - 6, cy - 2, 5, cx - 4, cy + 2, 9, g); box(m, cx + 4, cy - 2, 5, cx + 6, cy + 2, 9, g); // shoulders
      box(m, cx - 3, cy - 2, 9, cx + 3, cy + 2, 14, s); // head
      box(m, cx - 2, cy - 3, 11, cx + 2, cy - 2, 12, C.teal()); // visor
      box(m, cx - 3, cy - 3, 0, cx - 1, cy + 3, 2, g); box(m, cx + 1, cy - 3, 0, cx + 3, cy + 3, 2, g); // feet
    },
  },

  // --- plants ---
  {
    id: "fig-tree", name: "Tree", author: "willow",
    build: (m) => {
      const br = C.brown(), g = C.green(), dg = C.dkgreen();
      box(m, cx - 1, cy - 1, 0, cx + 1, cy + 1, 11, br);   // trunk
      ball(m, cx, cy, 14, 5, 5, 4, g);                     // canopy
      ball(m, cx - 3, cy + 2, 12, 2, 2, 2, dg); ball(m, cx + 3, cy - 2, 15, 2, 2, 2, dg);
    },
  },
  {
    id: "fig-flower", name: "Flower", author: "petal",
    build: (m) => {
      const g = C.green(), p = C.pink(), yc = C.yellow();
      box(m, cx, cy, 0, cx + 1, cy + 1, 13, g);            // stem
      v(m, cx - 2, cy, 6, g); v(m, cx - 3, cy, 6, g); v(m, cx + 2, cy, 8, g); // leaves
      const cz = 15;
      ball(m, cx, cy, cz, 1.6, 1.6, 1.6, yc);              // center
      v(m, cx - 3, cy, cz, p); v(m, cx + 3, cy, cz, p); v(m, cx, cy, cz + 3, p); v(m, cx, cy, cz - 3, p);
      v(m, cx - 2, cy, cz + 2, p); v(m, cx + 2, cy, cz + 2, p); v(m, cx - 2, cy, cz - 2, p); v(m, cx + 2, cy, cz - 2, p);
    },
  },
  {
    id: "fig-cactus", name: "Cactus", author: "sage",
    build: (m) => {
      const g = C.green();
      box(m, cx - 1, cy - 1, 3, cx + 2, cy + 2, 16, g);    // trunk
      box(m, cx - 4, cy - 1, 8, cx - 1, cy + 1, 9, g); box(m, cx - 4, cy - 1, 9, cx - 3, cy + 1, 13, g);  // left arm
      box(m, cx + 2, cy - 1, 10, cx + 5, cy + 1, 11, g); box(m, cx + 4, cy - 1, 11, cx + 5, cy + 1, 14, g); // right arm
      box(m, cx - 2, cy - 2, 0, cx + 3, cy + 3, 3, C.dkorange()); // pot
    },
  },
  {
    id: "fig-pot", name: "Plant", author: "ivy",
    build: (m) => {
      const g = C.green(), dg = C.dkgreen();
      box(m, cx - 3, cy - 3, 0, cx + 3, cy + 3, 5, C.dkorange()); // pot
      box(m, cx - 3, cy - 3, 5, cx + 3, cy + 3, 6, C.brown());    // soil
      box(m, cx, cy, 6, cx + 1, cy + 1, 13, dg);                  // stem
      ball(m, cx, cy, 9, 3, 3, 3, g); ball(m, cx - 2, cy + 1, 12, 2, 2, 3, dg); ball(m, cx + 2, cy - 1, 11, 2, 2, 2, g);
    },
  },

  // --- vehicles ---
  {
    id: "fig-car", name: "Car", author: "vroom",
    build: (m) => {
      const r = C.red(), k = C.black(), b = C.blue();
      box(m, cx - 6, cy - 2, 3, cx + 6, cy + 2, 6, r);     // lower body
      box(m, cx - 3, cy - 2, 6, cx + 3, cy + 2, 9, r);     // cabin
      box(m, cx - 2, cy - 3, 6, cx + 2, cy - 2, 9, b);     // windshield
      ball(m, cx - 4, cy - 2, 2, 1.5, 1.5, 1.5, k); ball(m, cx + 4, cy - 2, 2, 1.5, 1.5, 1.5, k);
      ball(m, cx - 4, cy + 2, 2, 1.5, 1.5, 1.5, k); ball(m, cx + 4, cy + 2, 2, 1.5, 1.5, 1.5, k); // wheels
      v(m, cx - 6, cy - 2, 4, C.yellow()); v(m, cx + 6, cy - 2, 4, C.yellow()); // lights
    },
  },
  {
    id: "fig-rocket", name: "Rocket", author: "blast",
    build: (m) => {
      const w = C.white(), r = C.red(), b = C.blue();
      box(m, cx - 2, cy - 2, 2, cx + 2, cy + 2, 14, w);    // body
      ball(m, cx, cy, 15, 2.2, 2.2, 3, r);                 // nose cone
      ball(m, cx, cy - 2, 10, 1.3, 1, 1.3, b);             // window
      box(m, cx - 3, cy - 1, 2, cx - 2, cy + 1, 6, r); box(m, cx + 2, cy - 1, 2, cx + 3, cy + 1, 6, r); // fins
      box(m, cx - 1, cy - 3, 2, cx + 1, cy - 2, 6, r); box(m, cx - 1, cy + 2, 2, cx + 1, cy + 3, 6, r);
      ball(m, cx, cy, 0, 1.5, 1.5, 1.5, C.orange()); v(m, cx, cy, 1, C.yellow()); // flame
    },
  },
  {
    id: "fig-boat", name: "Boat", author: "marina",
    build: (m) => {
      const br = C.brown(), w = C.white();
      box(m, cx - 5, cy - 2, 3, cx + 5, cy + 1, 5, br);    // hull
      box(m, cx - 4, cy - 2, 5, cx + 4, cy + 1, 6, C.dkbrown());
      box(m, cx, cy - 1, 6, cx + 1, cy, 16, C.tan());      // mast
      for (let z = 7; z < 16; z++) {                       // sail (triangle)
        const wdt = Math.floor((16 - z) * 0.7) + 1;
        box(m, cx + 1, cy - 1, z, cx + 1 + wdt, cy, z + 1, w);
      }
    },
  },
  {
    id: "fig-plane", name: "Plane", author: "ace",
    build: (m) => {
      const w = C.ltgray(), b = C.blue();
      box(m, cx - 6, cy - 1, 8, cx + 5, cy + 1, 11, w);    // fuselage
      ball(m, cx + 5, cy, 9, 1.5, 1, 1.5, b);              // nose
      box(m, cx - 1, cy - 6, 9, cx + 1, cy + 6, 10, w);    // wings
      box(m, cx - 6, cy - 3, 9, cx - 5, cy + 3, 10, w);    // tailplane
      box(m, cx - 6, cy - 1, 11, cx - 5, cy + 1, 14, w);   // fin
      box(m, cx - 2, cy - 1, 11, cx + 2, cy, 12, b);       // windows
    },
  },

  // --- houses ---
  {
    id: "fig-house", name: "House", author: "homey",
    build: (m) => {
      const wl = C.tan(), r = C.red();
      box(m, cx - 5, cy - 5, 0, cx + 5, cy + 5, 9, wl);    // walls
      for (let i = 0; i < 6; i++) box(m, cx - 5 + i, cy - 5, 9 + i, cx + 5 - i, cy + 5, 10 + i, r); // pitched roof
      box(m, cx - 1, cy - 5, 0, cx + 1, cy - 4, 5, C.dkbrown()); // door
      box(m, cx - 4, cy - 5, 5, cx - 2, cy - 4, 7, C.blue()); box(m, cx + 2, cy - 5, 5, cx + 4, cy - 4, 7, C.blue()); // windows
    },
  },
  {
    id: "fig-tower", name: "Tower", author: "rook",
    build: (m) => {
      const s = C.ltgray(), dg = C.dkgray(), r = C.red();
      box(m, cx - 3, cy - 3, 0, cx + 3, cy + 3, 15, s);    // tower
      const merlons: Array<[number, number]> = [[cx - 3, cy - 3], [cx + 2, cy - 3], [cx - 3, cy + 2], [cx + 2, cy + 2], [cx, cy - 3], [cx - 3, cy], [cx + 2, cy], [cx, cy + 2]];
      for (const [bx, by] of merlons) box(m, bx, by, 15, bx + 1, by + 1, 17, s); // battlements
      box(m, cx - 1, cy - 3, 0, cx + 1, cy - 2, 4, dg);    // door
      v(m, cx, cy - 3, 8, C.black()); v(m, cx - 2, cy - 3, 11, C.black()); v(m, cx + 2, cy - 3, 11, C.black()); // windows
      box(m, cx, cy, 17, cx + 1, cy + 1, 19, C.brown());   // flagpole
      box(m, cx + 1, cy, 17, cx + 3, cy + 1, 19, r);       // flag
    },
  },

  // --- planets / sky ---
  {
    id: "fig-planet", name: "Planet", author: "cosmo",
    build: (m) => {
      const p = C.purple(), t = C.teal(), y = C.yellow();
      ball(m, cx, cy, 10, 5, 5, 5, p);                     // globe
      ball(m, cx, cy - 3, 12, 2, 2, 2, t);                 // band
      for (let x = 0; x < FIG.X; x++) for (let yy = 0; yy < FIG.Y; yy++) {
        const dx = (x - cx) / 8.5, dy = (yy - cy) / 8.5, d = dx * dx + dy * dy;
        if (d <= 1.05 && d >= 0.55) v(m, x, yy, 10, y);    // ring
      }
    },
  },
  {
    id: "fig-star", name: "Star", author: "nova",
    build: (m) => {
      const y = C.yellow(), o = C.orange();
      ball(m, cx, cy, 10, 3.5, 2, 3.5, y);                 // disc (thin in Y)
      for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]] as Array<[number, number]>)
        for (let r = 4; r <= 6; r++) v(m, cx + dx * r, cy, 10 + dz * r, o); // rays
    },
  },
  {
    id: "fig-moon", name: "Moon", author: "luna",
    build: (m) => {
      ball(m, cx, cy, 10, 5, 2, 5, C.ltgray());            // full disc
      for (let x = 0; x < FIG.X; x++) for (let z = 0; z < FIG.Z; z++) {
        const dx = (x - (cx + 4)) / 4.6, dz = (z - 10) / 4.6;
        if (dx * dx + dz * dz <= 1) for (let yy = cy - 2; yy <= cy + 2; yy++) m.set(x, yy, z, 0); // carve crescent
      }
      v(m, cx - 6, cy, 16, C.yellow()); v(m, cx + 6, cy, 4, C.yellow()); // stars
    },
  },

  // --- insects ---
  {
    id: "fig-butterfly", name: "Flutter", author: "flit",
    build: (m) => {
      const b = C.purple(), p = C.pink(), k = C.black();
      box(m, cx, cy, 6, cx + 1, cy + 1, 14, k);            // body
      v(m, cx, cy, 15, k); v(m, cx - 1, cy, 16, k); v(m, cx + 1, cy, 16, k); // antennae
      ball(m, cx - 4, cy, 11, 3, 1, 2.5, b); ball(m, cx - 4, cy, 7, 3, 1, 2, p); // left wings
      ball(m, cx + 5, cy, 11, 3, 1, 2.5, b); ball(m, cx + 5, cy, 7, 3, 1, 2, p); // right wings
    },
  },
  {
    id: "fig-caterpillar", name: "Crawly", author: "munch",
    build: (m) => {
      const g = C.green(), dg = C.dkgreen();
      for (let i = 0; i < 6; i++) ball(m, cx - 6 + i * 2, cy, 5, 1.8, 1.8, 1.8, i % 2 ? g : dg);
      ball(m, cx + 6, cy, 5, 2, 2, 2, g);                  // head
      eye(m, cx + 5, cy - 2, 6); eye(m, cx + 7, cy - 2, 6);
      v(m, cx + 7, cy, 8, C.black()); v(m, cx + 5, cy, 8, C.black()); // antennae
    },
  },
  {
    id: "fig-spider", name: "Spider", author: "webby",
    build: (m) => {
      const k = C.black(), dk = C.dkgray();
      ball(m, cx, cy, 5, 2.5, 3, 2.5, k);                  // abdomen
      ball(m, cx, cy - 3, 5, 2, 2, 2, k);                  // head
      for (const ly of [cy - 2, cy - 1, cy + 1, cy + 2]) {
        v(m, cx - 3, ly, 4, dk); v(m, cx - 4, ly, 5, dk); v(m, cx - 5, ly, 4, dk);
        v(m, cx + 3, ly, 4, dk); v(m, cx + 4, ly, 5, dk); v(m, cx + 5, ly, 4, dk); // legs
      }
      eye(m, cx - 1, cy - 5, 6); eye(m, cx + 1, cy - 5, 6);
    },
  },

  // --- mushrooms ---
  {
    id: "fig-mushroom2", name: "Toadstool", author: "spore2",
    build: (m) => {
      const r = C.red(), w = C.white();
      box(m, cx - 1, cy - 1, 0, cx + 2, cy + 2, 7, C.cream()); // stem
      ball(m, cx, cy, 9, 5, 5, 3, r);                      // cap
      box(m, cx - 4, cy - 4, 6, cx + 4, cy + 4, 7, w);     // gills underside
      v(m, cx - 2, cy - 2, 11, w); v(m, cx + 2, cy, 12, w); v(m, cx, cy + 3, 10, w); v(m, cx - 3, cy + 1, 10, w); // spots
    },
  },
];

// Figures are modeled facing -Y; rotating 90° about the up axis turns their
// faces toward the camera. Fish and whale read better unrotated (side view).
const NO_ROTATE = new Set([
  "fig-fish", "fig-whale",
  // vehicles/houses face -Y and read wrong if spun; flat sky shapes face camera
  "fig-car", "fig-boat", "fig-plane", "fig-house", "fig-star", "fig-moon", "fig-butterfly",
]);

function rotateZ90(src: VoxelModel): VoxelModel {
  const out = new VoxelModel(FIG.X, FIG.Y, FIG.Z);
  const S = FIG.Y;
  src.forEach((x, y, z, c) => out.set(S - 1 - y, x, z, c));
  return out;
}

/** Build the seed community creations as documents (uniform size, default palette). */
export function buildSeedFigures(): Array<{ id: string; name: string; author: string; doc: VoxDocument }> {
  return FIGURES.map((f) => {
    let m = new VoxelModel(FIG.X, FIG.Y, FIG.Z);
    f.build(m);
    if (!NO_ROTATE.has(f.id)) m = rotateZ90(m);
    return { id: f.id, name: f.name, author: f.author, doc: new VoxDocument({ models: [m] }) };
  });
}

/** Plausible human-like handles for auto-generated (ambient) community figures. */
const AMBIENT_NAMES = [
  "Alex", "Sam", "Mia", "Leo", "Noa", "Kai", "Zoe", "Max", "Ivy", "Rio",
  "Eli", "Luca", "Nina", "Theo", "Ada", "Finn", "Cleo", "Jay", "Remy", "Suki",
  "Bo", "Wren", "Otis", "Lux", "Juno", "Pax", "Esme", "Tate", "Indi", "Soren",
];

function pick<T>(a: T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}

/** HSL (h:0-360, s/l:0-100) → "#rrggbb". */
function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x: number) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

/**
 * Build a random figure with a randomized color scheme — used for ambient
 * community growth. Reuses a random {@link FIGURES} template, then recolors its
 * mid-tone palette indices to fresh, mutually-distinct hues (near-black and
 * near-white indices are left intact so eyes/outlines stay readable).
 */
export function randomFigureDoc(): { name: string; author: string; doc: VoxDocument } {
  const f = pick(FIGURES);
  let m = new VoxelModel(FIG.X, FIG.Y, FIG.Z);
  f.build(m);
  if (!NO_ROTATE.has(f.id)) m = rotateZ90(m);
  const doc = new VoxDocument({ models: [m] });

  // Distinct color indices the model actually uses.
  const used: number[] = [];
  const seen = new Set<number>();
  m.forEach((_x, _y, _z, c) => {
    if (!seen.has(c)) {
      seen.add(c);
      used.push(c);
    }
  });

  // Recolor mid-tone indices around a random base hue, spaced apart.
  const baseHue = Math.floor(Math.random() * 360);
  const recolorable = used.filter((ci) => {
    const c = DPAL.get(ci);
    const lum = (c.r + c.g + c.b) / 3;
    return lum >= 40 && lum <= 220; // keep eyes/outlines (near-black/near-white)
  });
  recolorable.forEach((ci, i) => {
    const hue = (baseHue + (i * 360) / Math.max(recolorable.length, 1) + (Math.random() * 20 - 10) + 360) % 360;
    const sat = 50 + Math.random() * 40;
    const lit = 40 + Math.random() * 28;
    doc.palette.set(ci, hexToRGBA(hslToHex(hue, sat, lit)));
  });

  return { name: f.name, author: pick(AMBIENT_NAMES), doc };
}
