import { VoxDocument } from "../core/Document";
import { rgbaToU32 } from "../core/palette";

/**
 * Serializes a {@link VoxDocument} to the MagicaVoxel .vox format (version 150),
 * including a minimal nTRN -> nGRP -> (nTRN -> nSHP) scene graph and LAYR chunks
 * so multi-model placement and layers are preserved and the file opens in
 * MagicaVoxel.
 *
 * Uses a growable Uint8Array buffer (never array spreads) so large models with
 * hundreds of thousands of voxels serialize without blowing the call stack.
 */

class ByteBuffer {
  private buf = new Uint8Array(4096);
  len = 0;

  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  u8(v: number): void {
    this.ensure(1);
    this.buf[this.len++] = v & 0xff;
  }
  i32(v: number): void {
    this.ensure(4);
    this.buf[this.len++] = v & 0xff;
    this.buf[this.len++] = (v >> 8) & 0xff;
    this.buf[this.len++] = (v >> 16) & 0xff;
    this.buf[this.len++] = (v >> 24) & 0xff;
  }
  fourcc(s: string): void {
    this.ensure(4);
    for (let i = 0; i < 4; i++) this.buf[this.len++] = s.charCodeAt(i);
  }
  str(s: string): void {
    const b = new TextEncoder().encode(s);
    this.i32(b.length);
    this.ensure(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }
  dict(d: Record<string, string>): void {
    const keys = Object.keys(d);
    this.i32(keys.length);
    for (const k of keys) {
      this.str(k);
      this.str(d[k]);
    }
  }
  append(other: ByteBuffer): void {
    this.ensure(other.len);
    this.buf.set(other.buf.subarray(0, other.len), this.len);
    this.len += other.len;
  }
  toArrayBuffer(): ArrayBuffer {
    return this.buf.slice(0, this.len).buffer;
  }
}

/** Build one chunk (id, content, optional children) into a fresh ByteBuffer. */
function chunk(id: string, content: ByteBuffer, children?: ByteBuffer): ByteBuffer {
  const w = new ByteBuffer();
  w.fourcc(id);
  w.i32(content.len);
  w.i32(children ? children.len : 0);
  w.append(content);
  if (children) w.append(children);
  return w;
}

function sizeContent(x: number, y: number, z: number): ByteBuffer {
  const w = new ByteBuffer();
  w.i32(x);
  w.i32(y);
  w.i32(z);
  return w;
}

function xyziContent(doc: VoxDocument, modelIndex: number): ByteBuffer {
  const m = doc.models[modelIndex];
  const w = new ByteBuffer();
  w.i32(m.count);
  m.forEach((x, y, z, c) => {
    w.u8(x);
    w.u8(y);
    w.u8(z);
    w.u8(c);
  });
  return w;
}

function rgbaContent(doc: VoxDocument): ByteBuffer {
  const w = new ByteBuffer();
  for (let i = 0; i < 256; i++) {
    const idx = Math.min(i + 1, 255);
    const c = doc.palette.colors[idx];
    w.u8(c.r);
    w.u8(c.g);
    w.u8(c.b);
    w.u8(c.a);
  }
  return w;
}

function trnContent(
  nodeId: number,
  childId: number,
  layerId: number,
  t?: [number, number, number],
  name?: string
): ByteBuffer {
  const w = new ByteBuffer();
  w.i32(nodeId);
  w.dict(name ? { _name: name } : {});
  w.i32(childId);
  w.i32(-1);
  w.i32(layerId);
  w.i32(1);
  w.dict(t && (t[0] || t[1] || t[2]) ? { _t: `${t[0]} ${t[1]} ${t[2]}` } : {});
  return w;
}

function grpContent(nodeId: number, children: number[]): ByteBuffer {
  const w = new ByteBuffer();
  w.i32(nodeId);
  w.dict({});
  w.i32(children.length);
  for (const c of children) w.i32(c);
  return w;
}

function shpContent(nodeId: number, modelId: number): ByteBuffer {
  const w = new ByteBuffer();
  w.i32(nodeId);
  w.dict({});
  w.i32(1);
  w.i32(modelId);
  w.dict({});
  return w;
}

function layrContent(id: number, name: string, hidden: boolean): ByteBuffer {
  const w = new ByteBuffer();
  w.i32(id);
  w.dict({ _name: name, _hidden: hidden ? "1" : "0" });
  w.i32(-1);
  return w;
}

export function writeVox(doc: VoxDocument): ArrayBuffer {
  const children = new ByteBuffer();

  for (let i = 0; i < doc.models.length; i++) {
    const m = doc.models[i];
    children.append(chunk("SIZE", sizeContent(m.sizeX, m.sizeY, m.sizeZ)));
    children.append(chunk("XYZI", xyziContent(doc, i)));
  }

  const transformChildIds: number[] = [];
  const sceneChunks = new ByteBuffer();
  let nextId = 2;
  for (const p of doc.placements) {
    const trnId = nextId++;
    const shpId = nextId++;
    transformChildIds.push(trnId);
    sceneChunks.append(
      chunk("nTRN", trnContent(trnId, shpId, p.layerId, p.t, p.name))
    );
    sceneChunks.append(chunk("nSHP", shpContent(shpId, p.modelId)));
  }

  children.append(chunk("nTRN", trnContent(0, 1, -1)));
  children.append(chunk("nGRP", grpContent(1, transformChildIds)));
  children.append(sceneChunks);

  for (const l of doc.layers) {
    children.append(chunk("LAYR", layrContent(l.id, l.name, l.hidden)));
  }

  children.append(chunk("RGBA", rgbaContent(doc)));

  const out = new ByteBuffer();
  out.fourcc("VOX ");
  out.i32(150);
  out.fourcc("MAIN");
  out.i32(0);
  out.i32(children.len);
  out.append(children);
  return out.toArrayBuffer();
}

/** Trigger a browser download of the document as a .vox file. */
export function downloadVox(doc: VoxDocument, filename = "model.vox"): void {
  const buf = writeVox(doc);
  const blob = new Blob([buf], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".vox") ? filename : `${filename}.vox`;
  a.click();
  URL.revokeObjectURL(url);
}

export { rgbaToU32 };
