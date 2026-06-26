// Generates white starter templates into public/templates/*.vox
// Minimal .vox (SIZE + XYZI, no RGBA → default palette, color index 1 = white).
import { writeFileSync, mkdirSync } from "fs";

const S = 20;
const C = 1; // default-palette white

const box = (set, x0, y0, z0, x1, y1, z1) => {
  for (let x = x0; x < x1; x++)
    for (let y = y0; y < y1; y++)
      for (let z = z0; z < z1; z++) set.add(`${x},${y},${z}`);
};

function human() {
  const s = new Set();
  box(s, 7, 8, 0, 9, 11, 8); // left leg
  box(s, 11, 8, 0, 13, 11, 8); // right leg
  box(s, 6, 7, 8, 14, 12, 15); // body
  box(s, 4, 8, 9, 6, 11, 15); // left arm
  box(s, 14, 8, 9, 16, 11, 15); // right arm
  box(s, 7, 7, 15, 13, 12, 20); // head
  return s;
}

function animal() {
  const s = new Set();
  box(s, 5, 7, 5, 15, 13, 11); // body
  box(s, 5, 7, 0, 7, 9, 5); // legs
  box(s, 5, 11, 0, 7, 13, 5);
  box(s, 13, 7, 0, 15, 9, 5);
  box(s, 13, 11, 0, 15, 13, 5);
  box(s, 14, 8, 8, 19, 12, 14); // head (front +x)
  box(s, 14, 7, 14, 16, 9, 16); // ears
  box(s, 16, 11, 14, 18, 13, 16);
  box(s, 2, 9, 8, 5, 11, 11); // tail
  return s;
}

function chunk(id, content, children = Buffer.alloc(0)) {
  const head = Buffer.alloc(12);
  head.write(id, 0, "ascii");
  head.writeInt32LE(content.length, 4);
  head.writeInt32LE(children.length, 8);
  return Buffer.concat([head, content, children]);
}

function buildVox(set) {
  const cells = [...set].map((k) => k.split(",").map(Number));
  const size = Buffer.alloc(12);
  size.writeInt32LE(S, 0);
  size.writeInt32LE(S, 4);
  size.writeInt32LE(S, 8);
  const xyzi = Buffer.alloc(4 + cells.length * 4);
  xyzi.writeInt32LE(cells.length, 0);
  cells.forEach(([x, y, z], i) => {
    const o = 4 + i * 4;
    xyzi[o] = x;
    xyzi[o + 1] = y;
    xyzi[o + 2] = z;
    xyzi[o + 3] = C;
  });
  const children = Buffer.concat([chunk("SIZE", size), chunk("XYZI", xyzi)]);
  const header = Buffer.alloc(8);
  header.write("VOX ", 0, "ascii");
  header.writeInt32LE(150, 4);
  return Buffer.concat([header, chunk("MAIN", Buffer.alloc(0), children)]);
}

mkdirSync("public/templates", { recursive: true });
writeFileSync("public/templates/human.vox", buildVox(human()));
writeFileSync("public/templates/animal.vox", buildVox(animal()));
console.log("wrote public/templates/human.vox, animal.vox");
