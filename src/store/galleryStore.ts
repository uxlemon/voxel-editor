import { validateAuthorName } from "../util/validation";
import { writeVox } from "../io/voxWriter";
import { buildSeedFigures } from "../core/figures";
import { assetUrl } from "../util/assets";

/**
 * Community-gallery store. Two backends, chosen at runtime:
 *  - REST  — when `window.VOXEL_API` is set (e.g. the WordPress theme), saved
 *            creations persist to the site database via the REST API.
 *  - IndexedDB — standalone/dev fallback (local to the browser).
 * `put` re-validates the author name client-side; the server validates too.
 */

interface VoxelApi {
  base: string; // e.g. https://site/wp-json/voxel/v1/
  nonce?: string;
}
function getApi(): VoxelApi | null {
  return (window as unknown as { VOXEL_API?: VoxelApi }).VOXEL_API ?? null;
}

function abToB64(buf: ArrayBuffer): string {
  let s = "";
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
function b64ToAb(s: string): ArrayBuffer {
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b.buffer;
}

type WireRecord = Omit<CreationRecord, "voxBytes"> & { voxBytes: string };
function toWire(rec: CreationRecord): WireRecord {
  return { ...rec, voxBytes: abToB64(rec.voxBytes) };
}
function fromWire(w: WireRecord): CreationRecord {
  return { ...w, voxBytes: b64ToAb(w.voxBytes) };
}

async function apiList(api: VoxelApi): Promise<CreationRecord[]> {
  const res = await fetch(api.base + "creations");
  if (!res.ok) throw new Error(String(res.status));
  const rows = (await res.json()) as WireRecord[];
  return rows.map(fromWire).sort(feedSort);
}
async function apiGet(api: VoxelApi, id: string): Promise<CreationRecord | undefined> {
  const res = await fetch(api.base + "creations/" + encodeURIComponent(id));
  if (!res.ok) return undefined;
  return fromWire((await res.json()) as WireRecord);
}
/** Stable per-browser owner token so the server can reject overwrites of other
 *  visitors' creations (the backend has no login). Persisted in localStorage. */
function ownerToken(): string {
  let t = "";
  try {
    t = localStorage.getItem("voxel-owner") || "";
    if (!t) {
      t = newId() + newId();
      localStorage.setItem("voxel-owner", t);
    }
  } catch {
    t = "anon";
  }
  return t;
}

async function apiPut(api: VoxelApi, rec: CreationRecord): Promise<CreationRecord> {
  const res = await fetch(api.base + "creations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(api.nonce ? { "X-WP-Nonce": api.nonce } : {}),
    },
    body: JSON.stringify({ ...toWire(rec), owner: ownerToken() }),
  });
  if (!res.ok) {
    let msg = "Save failed";
    try {
      const j = JSON.parse(await res.text());
      msg = j.message || msg;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }
  return rec;
}

export interface CreationRecord {
  id: string;
  name: string;
  author: string;
  /** raw .vox bytes */
  voxBytes: ArrayBuffer;
  /** PNG data URL thumbnail */
  thumb: string;
  /** id of the creation this was remixed from, or null */
  parentId: string | null;
  /** optional share caption */
  caption?: string;
  createdAt: number;
  updatedAt: number;
  /** Invisible discriminator: true = auto-generated (seed/ambient), absent/false
   *  = made by a real visitor. Human creations sort to the top of the feed. */
  auto?: boolean;
}

/** Feed order: human-made first, then auto-generated; newest-first within each. */
function feedSort(a: CreationRecord, b: CreationRecord): number {
  const ha = a.auto ? 1 : 0;
  const hb = b.auto ? 1 : 0;
  if (ha !== hb) return ha - hb;
  return b.updatedAt - a.updatedAt;
}

const DB_NAME = "voxel-game";
const STORE = "creations";
const SEED_FLAG = "voxel-game-seeded-v7";
// Old bundled samples to remove (keep the knight).
const OLD_SAMPLE_IDS = ["sample-monu1", "sample-3x3x3"];

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("updatedAt", "updatedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const galleryStore = {
  /** Newest first. */
  async list(): Promise<CreationRecord[]> {
    const api = getApi();
    if (api) return apiList(api);
    await delay(120);
    const db = await openDb();
    const all = await reqToPromise(tx(db, "readonly").getAll() as IDBRequest<CreationRecord[]>);
    return all.sort(feedSort);
  },

  async get(id: string): Promise<CreationRecord | undefined> {
    const api = getApi();
    if (api) return apiGet(api, id);
    await delay(60);
    const db = await openDb();
    return reqToPromise(tx(db, "readonly").get(id) as IDBRequest<CreationRecord | undefined>);
  },

  /** Insert or update. Re-validates the author name (server validates too). */
  async put(rec: CreationRecord): Promise<CreationRecord> {
    const v = validateAuthorName(rec.author);
    if (!v.ok) throw new Error(v.reason ?? "Invalid author name.");
    const api = getApi();
    if (api) return apiPut(api, rec);
    await delay(700); // simulate a network round-trip so the spinner shows
    const db = await openDb();
    const store = tx(db, "readwrite");
    await reqToPromise(store.put(rec));
    return rec;
  },

  /**
   * Fire-and-forget contribution used for ambient growth on page-leave. Uses
   * `navigator.sendBeacon` for the REST backend (the only reliable unload-time
   * POST) tagged `auto:true` so the server can rate-limit it; falls back to a
   * best-effort IndexedDB `put` standalone. Returns whether it was queued.
   */
  beaconContribute(rec: CreationRecord): boolean {
    if (!validateAuthorName(rec.author).ok) return false;
    const api = getApi();
    if (api) {
      // `auto` is the stored/sort flag; `ambient` triggers the server throttle.
      const body = JSON.stringify({ ...toWire(rec), auto: true, ambient: true, owner: ownerToken() });
      const blob = new Blob([body], { type: "application/json" });
      try {
        return navigator.sendBeacon(api.base + "creations", blob);
      } catch {
        return false;
      }
    }
    void this.put(rec).catch(() => {}); // dev/standalone fallback
    return true;
  },

  /** Seed the gallery with procedural figures/animals (uniform size) on first run. */
  async seedSamplesOnce(
    makeThumb: (voxBytes: ArrayBuffer) => Promise<string>
  ): Promise<void> {
    const api = getApi();
    if (api) {
      // Shared server: seed only if the gallery is empty.
      try {
        const existing = await apiList(api);
        if (existing.length > 0) return;
      } catch {
        return; // server unreachable — don't seed
      }
      for (const s of await buildSeeds(makeThumb)) {
        try {
          await apiPut(api, s);
        } catch {
          /* keep going */
        }
      }
      return;
    }
    if (localStorage.getItem(SEED_FLAG)) return;
    // Remove the old bundled-sample seeds from earlier versions.
    try {
      const db = await openDb();
      for (const id of OLD_SAMPLE_IDS) await reqToPromise(tx(db, "readwrite").delete(id));
    } catch {
      /* ignore */
    }
    for (const rec of await buildSeeds(makeThumb)) {
      try {
        const db = await openDb();
        await reqToPromise(tx(db, "readwrite").put(rec));
      } catch {
        /* a bad seed shouldn't block startup */
      }
    }
    localStorage.setItem(SEED_FLAG, "1");
  },
};

/** Build the full seed records (knight + figures) with thumbnails. */
async function buildSeeds(
  makeThumb: (voxBytes: ArrayBuffer) => Promise<string>
): Promise<CreationRecord[]> {
  const now = Date.now();
  const raw: Array<{ id: string; name: string; author: string; voxBytes: ArrayBuffer }> = [];
  try {
    const knight = await (await fetch(assetUrl("samples/chr_knight.vox"))).arrayBuffer();
    raw.push({ id: "sample-chr_knight", name: "Knight", author: "Visa", voxBytes: knight });
  } catch {
    /* ignore if missing */
  }
  for (const f of buildSeedFigures()) {
    raw.push({ id: f.id, name: f.name, author: f.author, voxBytes: writeVox(f.doc) });
  }
  const out: CreationRecord[] = [];
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    try {
      const thumb = await makeThumb(s.voxBytes);
      const t = now - i * 1000; // newest-first, recent timestamps
      out.push({
        id: s.id,
        name: s.name,
        author: s.author,
        voxBytes: s.voxBytes,
        thumb,
        parentId: null,
        createdAt: t,
        updatedAt: t,
        auto: true, // seeds are not visitor-made → sort below real human creations
      });
    } catch {
      /* skip a bad seed */
    }
  }
  return out;
}

export function newId(): string {
  // Date-based id with a random suffix; unique enough for a local gallery.
  return `c-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}
