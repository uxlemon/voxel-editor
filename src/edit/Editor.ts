import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { Viewport } from "../render/Viewport";
import { SceneRenderer } from "../render/SceneRenderer";
import { VoxDocument, Placement } from "../core/Document";
import { VoxelModel, VoxelSnapshot } from "../core/VoxelModel";
import { History, StrokeRecorder, EditVoxelsCommand, VoxelChange } from "./commands";

export type Tool =
  | "none" // no tool: left-drag orbits (turns) the model
  | "attach" // drag a box region to add voxels (single click = one voxel)
  | "erase"
  | "paint"
  | "eyedropper"
  | "fill"
  | "select";

export interface EditorHost {
  readonly viewport: Viewport;
  readonly scene: SceneRenderer;
  readonly history: History;
  doc: VoxDocument;
  setStatus(text: string): void;
  setHover(text: string): void;
  onColorPicked(index: number): void;
  /** Whether model editing is allowed (false in read-only world view). */
  canEdit(): boolean;
  /** Called after the active model's size/placement changed (full re-sync). */
  onStructureChanged?(): void;
  /** Called when the voxel selection changes (for the transform gizmo). */
  onSelectionChange?(): void;
  /** Called after an object is moved in world view (to refresh panels). */
  onObjectMoved?(): void;
}

/** Model-space face directions + their 4 corner offsets, for drawing the white
 *  border around the exposed faces of selected voxels. */
const HL_FACES: Array<{ d: [number, number, number]; corners: [number, number, number][] }> = [
  { d: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { d: [-1, 0, 0], corners: [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]] },
  { d: [0, 1, 0], corners: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]] },
  { d: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { d: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { d: [0, 0, -1], corners: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] },
];

interface Rot {
  c0: THREE.Vector3;
  c1: THREE.Vector3;
  c2: THREE.Vector3;
}

/** Snap a quaternion to the nearest 90° lattice rotation (column basis images). */
function quantizeRotation(q: THREE.Quaternion): Rot {
  const e = new THREE.Matrix4().makeRotationFromQuaternion(q).elements;
  const snap = (x: number, y: number, z: number): THREE.Vector3 => {
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    if (ax >= ay && ax >= az) return new THREE.Vector3(Math.sign(x) || 1, 0, 0);
    if (ay >= az) return new THREE.Vector3(0, Math.sign(y) || 1, 0);
    return new THREE.Vector3(0, 0, Math.sign(z) || 1);
  };
  return {
    c0: snap(e[0], e[1], e[2]),
    c1: snap(e[4], e[5], e[6]),
    c2: snap(e[8], e[9], e[10]),
  };
}

/** Shift a set of "x,y,z" cell keys by a vector. */
function shiftKeys(keys: Set<string>, s: { x: number; y: number; z: number }): Set<string> {
  return new Set(
    [...keys].map((k) => {
      const [x, y, z] = k.split(",").map(Number);
      return `${x + s.x},${y + s.y},${z + s.z}`;
    })
  );
}

function applyR(R: Rot, v: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(
    R.c0.x * v.x + R.c1.x * v.y + R.c2.x * v.z,
    R.c0.y * v.x + R.c1.y * v.y + R.c2.y * v.z,
    R.c0.z * v.x + R.c1.z * v.y + R.c2.z * v.z
  );
}

interface VoxelTarget {
  placement: Placement;
  model: VoxelModel;
  solid: THREE.Vector3 | null; // solid cell under cursor (erase/paint)
  empty: THREE.Vector3; // empty neighbor along normal (attach)
  point: THREE.Vector3; // world hit point
  normal: THREE.Vector3; // world face normal (three space)
}

type Cell = { x: number; y: number; z: number };

/**
 * Mouse-driven voxel editing. Tools fall into three interaction styles:
 *  - freehand (attach/erase/paint): apply per cell while dragging
 *  - region   (box/line/select): anchor on press, preview on drag, commit on release
 *  - click    (fill/eyedropper): single action on press
 * Brush size and mirror axes apply to freehand and the box/line endpoints.
 */
export class Editor {
  tool: Tool = "none";
  color = 255; // default to (near-)black in the default palette
  brushSize = 1;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private controls: OrbitControls;
  private cursor: THREE.LineSegments;
  private regionBox: THREE.Mesh; // translucent box (attach hover/drag)
  private regionOutline: THREE.LineSegments; // wireframe box (select box drag)
  private faceQuad: THREE.Mesh; // pointed face (paint/fill/pick)
  private selectionBox: THREE.LineSegments; // selection bounding-box outline
  private selectionHighlight: THREE.LineSegments; // white border on selected voxels

  // freehand stroke
  private stroke: StrokeRecorder | null = null;
  private strokeModelId = -1;
  private painting = false;

  // region drag
  private regionAnchor: Cell | null = null;
  private regionErase = false;
  private regionPlacement: Placement | null = null;

  // plane lock (MagicaVoxel-style): a drag stays on the plane it started on
  private lockPlane: THREE.Plane | null = null;
  private lockAxis: "x" | "y" | "z" = "z";
  private lockValue = 0;
  private lockMeshPos = new THREE.Vector3();

  // selection
  private selection: { modelId: number; cells: Cell[] } | null = null;
  /** copied voxels (absolute coords + color), pasted back at the same position */
  private clipboard: Array<{ x: number; y: number; z: number; color: number }> | null = null;
  /** cells pinned in place after a paste (their originals stay as a second copy)
   *  until the selection changes; moving/transforming never clears these. */
  private pasteOrigin: Set<string> | null = null;
  /** how the Select tool picks: 3D box on a plane, screen rectangle, or same color */
  selectMode: "box" | "rect" | "color" = "rect";
  private rectEl: HTMLDivElement;
  private rectSelecting = false;
  private rectStart = { x: 0, y: 0 };

  // transform gizmo — three stacked rings/handles on one proxy:
  // scale (innermost), move (middle), rotate (outermost).
  private gizmos: Array<{
    mode: "translate" | "rotate" | "scale";
    tc: TransformControls;
    helper: THREE.Object3D;
  }> = [];
  private proxy = new THREE.Object3D();
  private gizmoTarget: "voxels" | "object" | null = null;
  /** When false (home/preview), the editor is read-only: no edit shortcuts. */
  interactive = true;
  /** The gizmo currently being dragged (exclusive — see setupGizmo). */
  private activeGizmo: { mode: string; tc: TransformControls; helper: THREE.Object3D } | null = null;
  private voxSession: {
    modelId: number;
    localCenter: THREE.Vector3;
    startPos: THREE.Vector3;
    rel: Array<{ v: THREE.Vector3; color: number }>;
    rec: Map<string, { x: number; y: number; z: number; before: number }>;
    last: string[];
    selBefore: Cell[];
    protectedKeys: Set<string>; // cells never cleared (floating-paste originals)
    beginSnap: VoxelSnapshot; // model state at drag start (for growing commit)
    beginT: [number, number, number];
  } | null = null;
  private objSession: { placement: Placement; startPos: THREE.Vector3; startT: [number, number, number] } | null = null;
  private selectedObject: Placement | null = null;

  constructor(private host: EditorHost, private canvas: HTMLCanvasElement) {
    this.controls = host.viewport.controls;
    this.controls.mouseButtons = {
      LEFT: null as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.applyToolMode();

    this.cursor = this.makeCursor();
    this.regionBox = this.makeRegionBox();
    this.regionOutline = this.makeRegionOutline();
    this.faceQuad = this.makeFaceQuad();
    this.selectionBox = this.makeSelectionBox();
    this.selectionHighlight = this.makeSelectionHighlight();
    host.viewport.scene.add(
      this.cursor,
      this.regionBox,
      this.regionOutline,
      this.faceQuad,
      this.selectionBox,
      this.selectionHighlight
    );

    this.rectEl = document.createElement("div");
    this.rectEl.className = "marquee";
    this.rectEl.style.display = "none";
    document.body.appendChild(this.rectEl);

    this.setupGizmo();

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("keydown", this.onKeyDown);
  }

  // --- transform gizmo ---
  private setupGizmo(): void {
    const vp = this.host.viewport;
    vp.scene.add(this.proxy);

    // Hide the plane-translation/scale handles (the XY/YZ/XZ squares) — they're
    // confusing for voxel work. Lock their visibility off so TransformControls
    // can't re-show them each frame. Keep the X/Y/Z axis arrows.
    const lockHidden = (o: THREE.Object3D) => {
      o.visible = false;
      Object.defineProperty(o, "visible", { get: () => false, set: () => {}, configurable: true });
    };

    // Inside → outside: scale, move, rotate. Distinct sizes keep the handles
    // from overlapping so each grabs cleanly.
    const specs: Array<{ mode: "scale" | "translate" | "rotate"; size: number }> = [
      { mode: "scale", size: 0.5 },
      { mode: "translate", size: 0.9 },
      { mode: "rotate", size: 1.35 },
    ];
    for (const spec of specs) {
      const g = new TransformControls(vp.camera, this.canvas);
      g.setMode(spec.mode);
      g.setSize(spec.size);
      if (spec.mode === "translate") g.setTranslationSnap(1);
      if (spec.mode === "rotate") {
        g.setRotationSnap(null as unknown as number); // free; Shift → 90° snap
        window.addEventListener("keydown", (e) => {
          if (e.key === "Shift") g.setRotationSnap(Math.PI / 2);
        });
        window.addEventListener("keyup", (e) => {
          if (e.key === "Shift") g.setRotationSnap(null as unknown as number);
        });
      }
      g.attach(this.proxy);
      g.enabled = false;
      // r0.169+ exposes a separate helper object to add to the scene
      const helper = (g as unknown as { getHelper?: () => THREE.Object3D }).getHelper
        ? (g as unknown as { getHelper: () => THREE.Object3D }).getHelper()
        : (g as unknown as THREE.Object3D);
      helper.visible = false;
      (helper as unknown as { __isGizmoHelper?: boolean }).__isGizmoHelper = true;
      vp.scene.add(helper);
      if (spec.mode === "rotate") {
        // Hide the screen-space (E, yellow) and free-rotation (XYZE, gray)
        // handles — voxel rotation only makes sense about X/Y/Z.
        helper.traverse((o) => {
          if (o.name === "E" || o.name === "XYZE") lockHidden(o);
        });
      } else {
        helper.traverse((o) => {
          if (o.name === "XY" || o.name === "YZ" || o.name === "XZ") lockHidden(o);
        });
      }
      const entry = { mode: spec.mode, tc: g, helper };
      // Exclusive drag ownership: the three gizmos share one proxy, so a single
      // pointer drag must drive exactly ONE transform session. Without this,
      // overlapping handles can start two sessions on the same press — the
      // second snapshots the already-mutated state, corrupting undo.
      g.addEventListener("dragging-changed", (e) => {
        const dragging = (e as unknown as { value: boolean }).value;
        this.controls.enabled = !dragging;
        if (dragging) {
          if (this.activeGizmo) return; // another gizmo already owns this drag
          this.activeGizmo = entry;
          // lock the siblings out for the duration of this drag (runs before
          // their own pointerdown handlers, so they bail on enabled === false)
          for (const o of this.gizmos) if (o !== entry) o.tc.enabled = false;
          this.beginGizmo();
        } else {
          if (this.activeGizmo !== entry) return;
          this.commitGizmo();
          this.activeGizmo = null;
          // restore the sibling handles (refreshSelectionVisuals also re-attaches)
          this.showGizmoHelper(this.gizmoTarget !== null);
        }
      });
      g.addEventListener("objectChange", () => {
        if (this.activeGizmo === entry) this.applyGizmo();
      });
      this.gizmos.push(entry);
    }

    // keep every gizmo using the live (possibly switched) camera
    vp.addFrameCallback(() => {
      for (const g of this.gizmos) (g.tc as unknown as { camera: THREE.Camera }).camera = vp.camera;
    });
  }

  // --- visuals ---
  private makeCursor(): THREE.LineSegments {
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02));
    const mat = new THREE.LineBasicMaterial({ color: 0x00ff88, depthTest: false });
    const seg = new THREE.LineSegments(geo, mat);
    seg.visible = false;
    seg.renderOrder = 999;
    return seg;
  }
  private makeRegionBox(): THREE.Mesh {
    // translucent filled box used as the attach placeholder (current color, 50%)
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      depthTest: false, // draw on top so it never z-fights the voxel surface
    });
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    m.visible = false;
    m.renderOrder = 1000;
    return m;
  }
  private makeRegionOutline(): THREE.LineSegments {
    const seg = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0x00ff88 })
    );
    seg.visible = false;
    return seg;
  }
  private makeFaceQuad(): THREE.Mesh {
    // a single unit face shown on the pointed voxel (paint/fill/pick)
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
      depthTest: false,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.98), mat);
    m.visible = false;
    m.renderOrder = 1001;
    return m;
  }
  private makeSelectionBox(): THREE.LineSegments {
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    const mat = new THREE.LineBasicMaterial({ color: 0xffcc00 });
    const seg = new THREE.LineSegments(geo, mat);
    seg.visible = false;
    return seg;
  }

  private makeSelectionHighlight(): THREE.LineSegments {
    // depth-tested (not x-ray): the border is occluded by voxels in front.
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff });
    const seg = new THREE.LineSegments(new THREE.BufferGeometry(), mat);
    seg.visible = false;
    return seg;
  }

  /** Rebuild the white per-voxel border for the current selection. */
  private updateSelectionHighlight(meshPos: THREE.Vector3): void {
    const sel = this.selection;
    if (!sel || sel.cells.length === 0) {
      this.selectionHighlight.visible = false;
      return;
    }
    const set = new Set(sel.cells.map((c) => `${c.x},${c.y},${c.z}`));
    const pos: number[] = [];
    const EPS = 0.012; // lift the border just off the surface to avoid z-fighting
    // per cell, draw the 4 edges of each face whose neighbor isn't selected
    for (const c of sel.cells) {
      for (const f of HL_FACES) {
        if (set.has(`${c.x + f.d[0]},${c.y + f.d[1]},${c.z + f.d[2]}`)) continue;
        // outward normal in three space (three-y = model z, three-z = model y)
        const nx = f.d[0] * EPS, ny = f.d[2] * EPS, nz = f.d[1] * EPS;
        const cs = f.corners.map(([cx, cy, cz]) => [
          c.x + cx + nx,
          c.z + cz + ny,
          c.y + cy + nz,
        ]);
        for (let i = 0; i < 4; i++) {
          const a = cs[i];
          const b = cs[(i + 1) % 4];
          pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
        }
      }
    }
    const geo = this.selectionHighlight.geometry;
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.computeBoundingSphere();
    this.selectionHighlight.position.copy(meshPos);
    this.selectionHighlight.visible = true;
  }

  private updatePointer(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private pick(): VoxelTarget | null {
    this.raycaster.setFromCamera(this.pointer, this.host.viewport.camera);
    const hits = this.raycaster.intersectObjects(
      this.host.scene.raycastTargets,
      false
    );
    const hit = hits.find((h) => (h.object as THREE.Mesh).visible && h.face);

    if (hit && hit.face) {
      const placement = hit.object.userData.placement as Placement;
      if (!placement) return null;
      const model = this.host.doc.models[placement.modelId];
      const meshPos = hit.object.position;
      const n = hit.face.normal;
      return {
        placement,
        model,
        solid: this.toVoxel(hit.point, n, meshPos, -0.5),
        empty: this.toVoxel(hit.point, n, meshPos, +0.5),
        point: hit.point.clone(),
        normal: n.clone(),
      };
    }

    // Fallback: draw on the editable volume box (floor + far walls).
    const box = this.host.scene.volumeBox;
    const boxHits = this.raycaster.intersectObjects(box.pickTargets, false);
    const bh = boxHits[0];
    const ap = this.host.doc.placements.find(
      (pl) => pl.modelId === this.host.doc.activeModel
    );
    if (!bh || !ap) return null;
    const model = this.host.doc.models[this.host.doc.activeModel];
    const cell = box.cellForHit(bh.object, bh.point);
    if (!cell) return null;
    const empty = new THREE.Vector3(cell.x, cell.y, cell.z);
    return {
      placement: ap,
      model,
      solid: model.has(cell.x, cell.y, cell.z) ? empty.clone() : null,
      empty,
      point: bh.point.clone(),
      normal: bh.face ? bh.face.normal.clone() : new THREE.Vector3(0, 1, 0),
    };
  }

  private toVoxel(
    point: THREE.Vector3,
    normal: THREE.Vector3,
    meshPos: THREE.Vector3,
    nudge: number
  ): THREE.Vector3 {
    const lx = point.x + normal.x * nudge - meshPos.x;
    const ly = point.y + normal.y * nudge - meshPos.y;
    const lz = point.z + normal.z * nudge - meshPos.z;
    return new THREE.Vector3(Math.floor(lx), Math.floor(lz), Math.floor(ly));
  }

  private isRegionTool(): boolean {
    // attach/erase/paint drag a box; select drags a box selection
    return (
      this.tool === "attach" ||
      this.tool === "erase" ||
      this.tool === "paint" ||
      this.tool === "select"
    );
  }

  // --- pointer handling ---
  /**
   * Establish the locked work plane from the first target of a stroke. The
   * plane passes through the base cell's center along the hit normal axis, so
   * dragging stays on that one layer (like MagicaVoxel) instead of climbing
   * over voxels.
   */
  private beginLock(target: VoxelTarget, base: Cell): void {
    const n = target.normal;
    // map three normal axis -> model axis
    if (Math.abs(n.x) > 0.5) this.lockAxis = "x";
    else if (Math.abs(n.y) > 0.5) this.lockAxis = "z"; // three-y is model z (up)
    else this.lockAxis = "y"; // three-z is model y (depth)
    this.lockValue = base[this.lockAxis];
    this.lockMeshPos.copy(
      this.host.scene.meshFor(target.placement)?.position ??
        this.host.scene.positionFor(target.placement, target.model)
    );
    // plane through base cell center, normal = three normal axis (unit)
    const center = new THREE.Vector3(
      this.lockMeshPos.x + base.x + 0.5,
      this.lockMeshPos.y + base.z + 0.5,
      this.lockMeshPos.z + base.y + 0.5
    );
    const axis = new THREE.Vector3(
      Math.abs(n.x) > 0.5 ? Math.sign(n.x) : 0,
      Math.abs(n.y) > 0.5 ? Math.sign(n.y) : 0,
      Math.abs(n.z) > 0.5 ? Math.sign(n.z) : 0
    );
    this.lockPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(axis, center);
  }

  /** Current cell under the cursor, projected onto the locked plane. */
  private lockedCell(): Cell | null {
    if (!this.lockPlane) return null;
    const pt = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.lockPlane, pt)) return null;
    const lx = pt.x - this.lockMeshPos.x;
    const ly = pt.y - this.lockMeshPos.y;
    const lz = pt.z - this.lockMeshPos.z;
    const cell: Cell = {
      x: Math.floor(lx),
      y: Math.floor(lz),
      z: Math.floor(ly),
    };
    cell[this.lockAxis] = this.lockValue; // keep the locked layer fixed
    return cell;
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (this.rectSelecting) {
      this.updateRectOverlay(e.clientX, e.clientY);
      return;
    }
    if (this.tool === "none") {
      this.cursor.visible = false;
      this.hidePlaceholders();
      this.canvas.style.cursor = "grab";
      this.host.setHover("");
      return;
    }
    if (!this.host.canEdit()) {
      this.cursor.visible = false;
      this.host.setHover("");
      return;
    }
    this.updatePointer(e);
    const target = this.pick();
    this.updateCursor(target);
    this.reportHover(target);

    if (this.painting) {
      const cell = this.lockedCell();
      if (cell) this.applyFreehandAt(cell);
    } else if (this.regionAnchor) {
      const cur = this.lockedCell();
      if (cur) this.updateRegionPreview(this.regionAnchor, cur);
    }
  };

  private reportHover(target: VoxelTarget | null): void {
    if (!target) {
      this.host.setHover("");
      return;
    }
    const c = this.tool === "attach" ? target.empty : target.solid ?? target.empty;
    this.host.setHover(`▦ ${c.x}, ${c.y}, ${c.z}`);
  }

  /** With no tool selected, left-drag orbits (turns) the model. */
  applyToolMode(): void {
    this.controls.mouseButtons.LEFT =
      this.tool === "none" ? THREE.MOUSE.ROTATE : (null as unknown as THREE.MOUSE);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (this.tool === "none") return; // no tool: OrbitControls handles the drag
    if (this.overGizmo()) return; // a gizmo handle is being grabbed
    this.updatePointer(e);
    const target = this.pick();
    if (!this.host.canEdit()) {
      // world view: click an object to attach the move gizmo, empty to clear
      if (target) this.attachObjectGizmo(target.placement);
      else this.hideGizmo();
      return;
    }
    if (!target) return;

    if (this.tool === "eyedropper") {
      if (target.solid) {
        const c = target.model.get(target.solid.x, target.solid.y, target.solid.z);
        if (c) this.host.onColorPicked(c);
      }
      return;
    }

    if (this.tool === "fill") {
      this.doFill(target);
      return;
    }

    this.host.doc.activeModel = target.placement.modelId;

    if (this.tool === "select" && this.selectMode === "color") {
      this.selectSameColor(target);
      return;
    }
    if (this.tool === "select" && this.selectMode === "rect") {
      this.beginRectSelect(e);
      return;
    }

    if (this.isRegionTool()) {
      const base = this.regionCell(target);
      this.regionAnchor = base;
      this.regionErase = e.altKey;
      this.regionPlacement = target.placement;
      this.beginLock(target, base);
      this.controls.enabled = false;
      this.updateRegionPreview(base, base);
      return;
    }

    // freehand (erase / paint)
    this.strokeModelId = target.placement.modelId;
    this.stroke = new StrokeRecorder(target.model);
    this.painting = true;
    this.controls.enabled = false;
    const base = target.solid ?? target.empty;
    this.beginLock(target, { x: base.x, y: base.y, z: base.z });
    this.applyFreehandAt({ x: base.x, y: base.y, z: base.z });
  };

  private onPointerUp = (e?: PointerEvent): void => {
    if (this.rectSelecting) {
      this.rectSelecting = false;
      this.controls.enabled = true;
      this.rectEl.style.display = "none";
      if (e) this.finishRectSelect(e.clientX, e.clientY);
      return;
    }
    if (this.painting) {
      this.painting = false;
      this.controls.enabled = true;
      const label = this.tool === "erase" ? "Erase" : "Paint";
      const cmd = this.stroke?.finish(label);
      if (cmd) this.host.history.push(cmd);
      this.stroke = null;
      this.lockPlane = null;
      return;
    }
    if (this.regionAnchor && this.regionPlacement) {
      this.controls.enabled = true;
      this.regionBox.visible = false;
      this.regionOutline.visible = false;
      const anchor = this.regionAnchor;
      this.regionAnchor = null;
      // current cell projected onto the locked plane
      const cur = this.lockedCell() ?? anchor;
      if (this.tool === "select") {
        this.commitSelection(this.regionPlacement.modelId, anchor, cur);
      } else {
        this.commitRegion(this.regionPlacement, anchor, cur);
      }
      this.regionPlacement = null;
      this.lockPlane = null;
    }
  };

  /** The cell a region tool uses at the cursor. attach adds at the empty
   *  neighbor; erase/paint/select act on the pointed (solid) voxel. */
  private regionCell(t: VoxelTarget): Cell {
    if (this.tool === "attach" && !this.regionErase) return t.empty;
    return t.solid ?? t.empty;
  }

  // --- freehand ---
  private applyFreehandAt(base: Cell): void {
    if (!this.stroke) return;
    const model = this.host.doc.models[this.strokeModelId];
    const cells = this.brushCells(base);
    let changed = false;
    for (const c of cells) {
      if (this.tool === "attach") {
        changed = this.stroke.write(c.x, c.y, c.z, this.color) || changed;
      } else if (this.tool === "erase") {
        changed = this.stroke.write(c.x, c.y, c.z, 0) || changed;
      } else if (this.tool === "paint" && model.has(c.x, c.y, c.z)) {
        changed = this.stroke.write(c.x, c.y, c.z, this.color) || changed;
      }
    }
    if (changed) this.host.scene.syncModel(this.strokeModelId);
  }

  private brushCells(base: Cell): Cell[] {
    const r = Math.max(0, Math.floor((this.brushSize - 1) / 2));
    const out: Cell[] = [];
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++)
        for (let dz = -r; dz <= r; dz++)
          out.push({ x: base.x + dx, y: base.y + dy, z: base.z + dz });
    return out;
  }

  // --- region commit (box / line) ---
  private commitRegion(p: Placement, a: Cell, b: Cell): void {
    const model = this.host.doc.models[p.modelId];
    const cells = boxCells(a, b);
    const rec = new StrokeRecorder(model);
    // erase if the Erase tool, or Alt-dragging the Attach tool
    const erasing = this.tool === "erase" || (this.tool === "attach" && this.regionErase);
    for (const m of cells) {
      const solid = model.has(m.x, m.y, m.z);
      if (erasing) {
        if (solid) rec.write(m.x, m.y, m.z, 0);
      } else if (this.tool === "paint") {
        if (solid) rec.write(m.x, m.y, m.z, this.color); // recolor existing only
      } else {
        rec.write(m.x, m.y, m.z, this.color); // attach: add
      }
    }
    const label = erasing ? "Erase" : this.tool === "paint" ? "Paint" : "Attach";
    const cmd = rec.finish(label);
    if (cmd) {
      this.host.history.push(cmd);
      this.host.scene.syncModel(p.modelId);
    }
  }

  // --- fill (bucket): recolor the connected same-color component ---
  private doFill(target: VoxelTarget): void {
    if (!target.solid) return;
    const model = target.model;
    const start = target.solid;
    const from = model.get(start.x, start.y, start.z);
    if (from === 0 || from === this.color) return;

    const rec = new StrokeRecorder(model);
    const stack: Cell[] = [start];
    const seen = new Set<string>();
    const neighbors = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    while (stack.length) {
      const c = stack.pop()!;
      const k = `${c.x},${c.y},${c.z}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (model.get(c.x, c.y, c.z) !== from) continue;
      rec.write(c.x, c.y, c.z, this.color);
      for (const [dx, dy, dz] of neighbors)
        stack.push({ x: c.x + dx, y: c.y + dy, z: c.z + dz });
    }
    const cmd = rec.finish("Fill");
    if (cmd) {
      this.host.history.push(cmd);
      this.host.scene.syncModel(target.placement.modelId);
    }
  }

  // --- selection ---
  /** Replace the current selection with the given cells (empty clears it). */
  private setSelection(modelId: number, cells: Cell[]): void {
    if (cells.length === 0) {
      this.clearSelection();
      this.host.setStatus("Selection cleared");
      return;
    }
    this.selection = { modelId, cells };
    this.pasteOrigin = null; // a fresh selection is not a pinned paste
    this.showSelectionOutline();
    this.attachVoxelGizmo(modelId, cells);
    this.host.onSelectionChange?.();
    this.host.setStatus(
      `Selected ${cells.length} voxels · drag the gizmo, or arrows/Del/Ctrl+D`
    );
  }

  private commitSelection(modelId: number, a: Cell, b: Cell): void {
    const model = this.host.doc.models[modelId];
    const cells = boxCells(a, b).filter((c) => model.has(c.x, c.y, c.z));
    this.setSelection(modelId, cells);
  }

  /** Select all voxels in the model sharing the clicked voxel's color. */
  private selectSameColor(target: VoxelTarget): void {
    if (!target.solid) return;
    const model = target.model;
    const color = model.get(target.solid.x, target.solid.y, target.solid.z);
    if (!color) return;
    const cells: Cell[] = [];
    model.forEach((x, y, z, c) => {
      if (c === color) cells.push({ x, y, z });
    });
    this.setSelection(target.placement.modelId, cells);
  }

  // --- rectangle (marquee) selection ---
  private beginRectSelect(e: PointerEvent): void {
    this.rectSelecting = true;
    this.controls.enabled = false;
    this.rectStart = { x: e.clientX, y: e.clientY };
    this.updateRectOverlay(e.clientX, e.clientY);
    this.rectEl.style.display = "block";
  }

  private updateRectOverlay(x: number, y: number): void {
    const x0 = Math.min(this.rectStart.x, x);
    const y0 = Math.min(this.rectStart.y, y);
    this.rectEl.style.left = `${x0}px`;
    this.rectEl.style.top = `${y0}px`;
    this.rectEl.style.width = `${Math.abs(x - this.rectStart.x)}px`;
    this.rectEl.style.height = `${Math.abs(y - this.rectStart.y)}px`;
  }

  private finishRectSelect(x: number, y: number): void {
    const minX = Math.min(this.rectStart.x, x);
    const maxX = Math.max(this.rectStart.x, x);
    const minY = Math.min(this.rectStart.y, y);
    const maxY = Math.max(this.rectStart.y, y);
    const modelId = this.host.doc.activeModel;
    const model = this.host.doc.models[modelId];
    const p = this.host.doc.placements.find((pl) => pl.modelId === modelId);
    if (!model || !p) return;
    const meshPos = this.host.scene.positionFor(p, model);
    const cam = this.host.viewport.camera;
    const rect = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector3();
    const cells: Cell[] = [];
    model.forEach((vx, vy, vz) => {
      v.set(meshPos.x + vx + 0.5, meshPos.y + vz + 0.5, meshPos.z + vy + 0.5);
      v.project(cam);
      if (v.z > 1) return; // behind camera
      const sx = (v.x * 0.5 + 0.5) * rect.width + rect.left;
      const sy = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY)
        cells.push({ x: vx, y: vy, z: vz });
    });
    this.setSelection(modelId, cells);
  }

  private showSelectionOutline(): void {
    if (!this.selection) {
      this.selectionBox.visible = false;
      this.selectionHighlight.visible = false;
      return;
    }
    const { modelId, cells } = this.selection;
    const p = this.host.doc.placements.find((pl) => pl.modelId === modelId);
    if (!p) return;
    const model = this.host.doc.models[modelId];
    const meshPos = this.host.scene.positionFor(p, model);
    this.updateSelectionHighlight(meshPos);
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const c of cells) {
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
      minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z);
    }
    const sx = maxX - minX + 1, sy = maxY - minY + 1, sz = maxZ - minZ + 1;
    this.selectionBox.geometry.dispose();
    this.selectionBox.geometry = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(sx, sz, sy)
    );
    // center in three space: meshPos + (minX + sx/2, minZ + sz/2, minY + sy/2)
    this.selectionBox.position.set(
      meshPos.x + minX + sx / 2,
      meshPos.y + minZ + sz / 2,
      meshPos.z + minY + sy / 2
    );
    this.selectionBox.visible = true;
  }

  /**
   * Apply voxel changes (already applied to the model) plus a selection
   * before/after, as one undoable command that also restores the selection.
   */
  private commitSelectionEdit(
    label: string,
    model: VoxelModel,
    modelId: number,
    changes: VoxelChange[],
    selBefore: Cell[] | null,
    selAfter: Cell[] | null,
    alreadyApplied: boolean
  ): void {
    if (changes.length === 0 && (selAfter?.length ?? 0) === (selBefore?.length ?? 0)) {
      // still allow selection-only update
    }
    const base = new EditVoxelsCommand(label, model, changes);
    if (!alreadyApplied) base.apply();
    const self = this;
    const setSel = (cells: Cell[] | null) => {
      self.selection = cells && cells.length ? { modelId, cells } : null;
    };
    setSel(selAfter);
    if (changes.length) {
      this.host.history.push({
        label,
        apply() {
          base.apply();
          setSel(selAfter);
        },
        undo() {
          base.undo();
          setSel(selBefore);
        },
      });
    }
    this.host.scene.syncModel(modelId);
    this.refreshSelectionVisuals();
  }

  /** Are any of these cells outside the model's current bounds? */
  private anyOutOfBounds(model: VoxelModel, cells: Cell[]): boolean {
    return cells.some(
      (c) => c.x < 0 || c.y < 0 || c.z < 0 || c.x >= model.sizeX || c.y >= model.sizeY || c.z >= model.sizeZ
    );
  }

  /**
   * Grow the model so the given (possibly out-of-bounds) cells fit, shifting
   * existing voxels into the positive range and adjusting the placement so the
   * model doesn't move in the world. Returns the applied shift.
   */
  private growModelToFit(modelId: number, cells: Cell[]): { x: number; y: number; z: number } {
    const model = this.host.doc.models[modelId];
    const p = this.host.doc.placements.find((pl) => pl.modelId === modelId)!;
    let minX = 0, minY = 0, minZ = 0;
    let maxX = model.sizeX - 1, maxY = model.sizeY - 1, maxZ = model.sizeZ - 1;
    for (const c of cells) {
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
      minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z);
    }
    const sx = Math.max(0, -minX), sy = Math.max(0, -minY), sz = Math.max(0, -minZ);
    const nX = Math.min(1024, Math.max(model.sizeX + sx, maxX + sx + 1));
    const nY = Math.min(1024, Math.max(model.sizeY + sy, maxY + sy + 1));
    const nZ = Math.min(1024, Math.max(model.sizeZ + sz, maxZ + sz + 1));
    if (sx === 0 && sy === 0 && sz === 0 && nX === model.sizeX && nY === model.sizeY && nZ === model.sizeZ)
      return { x: 0, y: 0, z: 0 };
    const oldX = model.sizeX, oldY = model.sizeY, oldZ = model.sizeZ;
    model.shiftResize(sx, sy, sz, nX, nY, nZ);
    // keep the model at the same world position after shift + resize
    p.t = [
      p.t[0] - Math.floor(oldX / 2) - sx + Math.floor(nX / 2),
      p.t[1] - Math.floor(oldY / 2) - sy + Math.floor(nY / 2),
      p.t[2] - Math.floor(oldZ / 2) - sz + Math.floor(nZ / 2),
    ];
    return { x: sx, y: sy, z: sz };
  }

  /** Undo command that swaps full model snapshots + placement + selection. */
  private pushSnapshotCommand(
    label: string,
    modelId: number,
    before: VoxelSnapshot,
    after: VoxelSnapshot,
    beforeT: [number, number, number],
    afterT: [number, number, number],
    selBefore: Cell[] | null,
    selAfter: Cell[] | null
  ): void {
    const model = this.host.doc.models[modelId];
    const p = this.host.doc.placements.find((pl) => pl.modelId === modelId)!;
    const self = this;
    const setSel = (c: Cell[] | null) => {
      self.selection = c && c.length ? { modelId, cells: c } : null;
    };
    this.host.history.push({
      label,
      apply() {
        model.restore(after);
        p.t = [...afterT];
        setSel(selAfter);
      },
      undo() {
        model.restore(before);
        p.t = [...beforeT];
        setSel(selBefore);
      },
    });
    this.host.onStructureChanged?.();
  }

  private moveSelection(dx: number, dy: number, dz: number): void {
    if (!this.selection) return;
    const modelId = this.selection.modelId;
    const model = this.host.doc.models[modelId];
    const before = this.selection.cells.slice();
    const targets = before.map((c) => ({ x: c.x + dx, y: c.y + dy, z: c.z + dz }));

    // out of bounds: grow the volume to fit (structural, snapshot-based undo)
    if (this.anyOutOfBounds(model, targets)) {
      this.moveSelectionGrowing(modelId, dx, dy, dz);
      return;
    }

    const changes: VoxelChange[] = [];
    const snapshot = before.map((c) => ({ c, color: model.get(c.x, c.y, c.z) }));
    const dstKeys = new Set(snapshot.map((s) => `${s.c.x + dx},${s.c.y + dy},${s.c.z + dz}`));
    const rec = new Map<string, number>(); // key -> before (lazy)
    const set = (x: number, y: number, z: number, v: number) => {
      if (!model.inBounds(x, y, z)) return;
      const k = `${x},${y},${z}`;
      const b = rec.has(k) ? (rec.get(k) as number) : model.get(x, y, z);
      if (!rec.has(k)) rec.set(k, b);
      model.set(x, y, z, v);
    };
    // clear vacated source cells, but keep any pinned paste originals (copies)
    for (const s of snapshot) {
      const k = `${s.c.x},${s.c.y},${s.c.z}`;
      if (dstKeys.has(k)) continue;
      if (this.pasteOrigin?.has(k)) continue;
      set(s.c.x, s.c.y, s.c.z, 0);
    }
    for (const s of snapshot) set(s.c.x + dx, s.c.y + dy, s.c.z + dz, s.color);
    for (const [k, b] of rec) {
      const [x, y, z] = k.split(",").map(Number);
      const after = model.get(x, y, z);
      if (b !== after) changes.push({ x, y, z, before: b, after });
    }
    const after = before
      .map((c) => ({ x: c.x + dx, y: c.y + dy, z: c.z + dz }))
      .filter((c) => model.inBounds(c.x, c.y, c.z));
    this.commitSelectionEdit("Move selection", model, modelId, changes, before, after, true);
  }

  /** Move a selection that crosses the volume boundary, growing the volume. */
  private moveSelectionGrowing(modelId: number, dx: number, dy: number, dz: number): void {
    const model = this.host.doc.models[modelId];
    const p = this.host.doc.placements.find((pl) => pl.modelId === modelId)!;
    const before = this.selection!.cells.slice();
    const beforeSnap = model.snapshot();
    const beforeT: [number, number, number] = [...p.t];

    const colors = before.map((c) => ({ c, color: model.get(c.x, c.y, c.z) }));
    // clear source cells (keep pinned paste originals)
    for (const s of colors) {
      if (this.pasteOrigin?.has(`${s.c.x},${s.c.y},${s.c.z}`)) continue;
      model.set(s.c.x, s.c.y, s.c.z, 0);
    }
    const targets = before.map((c) => ({ x: c.x + dx, y: c.y + dy, z: c.z + dz }));
    const shift = this.growModelToFit(modelId, targets);
    for (const s of colors)
      model.set(s.c.x + dx + shift.x, s.c.y + dy + shift.y, s.c.z + dz + shift.z, s.color);
    if (this.pasteOrigin) this.pasteOrigin = shiftKeys(this.pasteOrigin, shift);
    const after = targets.map((c) => ({ x: c.x + shift.x, y: c.y + shift.y, z: c.z + shift.z }));
    this.selection = { modelId, cells: after };
    this.pushSnapshotCommand("Move selection", modelId, beforeSnap, model.snapshot(), beforeT, [...p.t], before, after);
  }

  private deleteSelection(): void {
    if (!this.selection) return;
    const modelId = this.selection.modelId;
    const model = this.host.doc.models[modelId];
    const before = this.selection.cells.slice();
    const changes: VoxelChange[] = [];
    for (const c of before) {
      const b = model.get(c.x, c.y, c.z);
      if (b !== 0) changes.push({ x: c.x, y: c.y, z: c.z, before: b, after: 0 });
    }
    this.commitSelectionEdit("Delete selection", model, modelId, changes, before, null, false);
  }

  /**
   * Flip the selection across the given axis, stamping a MIRRORED COPY adjacent
   * to it on the + side (the original stays). Grows the volume if needed. The
   * mirrored copy becomes the new selection.
   */
  flipSelection(axis: "x" | "y" | "z"): void {
    if (!this.selection) return;
    const modelId = this.selection.modelId;
    const model = this.host.doc.models[modelId];
    const before = this.selection.cells.slice();
    let max = -Infinity;
    for (const c of before) max = Math.max(max, c[axis]);
    // mirror each cell across the plane just past the selection's max edge
    const mirrored = before.map((c) => {
      const color = model.get(c.x, c.y, c.z);
      const nc: Cell = { x: c.x, y: c.y, z: c.z };
      nc[axis] = 2 * max + 1 - c[axis];
      return { x: nc.x, y: nc.y, z: nc.z, color };
    });
    const targets = mirrored.map((m) => ({ x: m.x, y: m.y, z: m.z }));

    if (this.anyOutOfBounds(model, targets)) {
      const p = this.host.doc.placements.find((pl) => pl.modelId === modelId)!;
      const beforeSnap = model.snapshot();
      const beforeT: [number, number, number] = [...p.t];
      const shift = this.growModelToFit(modelId, targets);
      for (const m of mirrored) model.set(m.x + shift.x, m.y + shift.y, m.z + shift.z, m.color);
      const after = targets.map((t) => ({ x: t.x + shift.x, y: t.y + shift.y, z: t.z + shift.z }));
      this.selection = { modelId, cells: after };
      this.pushSnapshotCommand(`Flip ${axis}`, modelId, beforeSnap, model.snapshot(), beforeT, [...p.t], before, after);
    } else {
      const changes: VoxelChange[] = [];
      for (const m of mirrored) {
        const b = model.get(m.x, m.y, m.z);
        if (b !== m.color) {
          model.set(m.x, m.y, m.z, m.color);
          changes.push({ x: m.x, y: m.y, z: m.z, before: b, after: m.color });
        }
      }
      this.commitSelectionEdit(`Flip ${axis}`, model, modelId, changes, before, targets, true);
    }
    this.host.setStatus(`Flipped ${before.length} voxels on ${axis.toUpperCase()}`);
  }

  // --- select all / copy / paste ---
  private selectAll(): void {
    const modelId = this.host.doc.activeModel;
    const model = this.host.doc.models[modelId];
    if (!model) return;
    const cells: Cell[] = [];
    model.forEach((x, y, z) => cells.push({ x, y, z }));
    this.setSelection(modelId, cells);
  }

  private copySelection(): void {
    if (!this.selection) return;
    const model = this.host.doc.models[this.selection.modelId];
    this.clipboard = this.selection.cells
      .map((c) => ({ x: c.x, y: c.y, z: c.z, color: model.get(c.x, c.y, c.z) }))
      .filter((v) => v.color !== 0);
    this.host.setStatus(`Copied ${this.clipboard.length} voxels`);
  }

  private paste(): void {
    if (!this.clipboard || this.clipboard.length === 0) return;
    const modelId = this.host.doc.activeModel;
    const model = this.host.doc.models[modelId];
    const before = this.selection?.cells.slice() ?? null;
    const changes: VoxelChange[] = [];
    const cells: Cell[] = [];
    for (const v of this.clipboard) {
      if (!model.inBounds(v.x, v.y, v.z)) continue;
      const b = model.get(v.x, v.y, v.z);
      if (b !== v.color) changes.push({ x: v.x, y: v.y, z: v.z, before: b, after: v.color });
      cells.push({ x: v.x, y: v.y, z: v.z });
    }
    this.commitSelectionEdit("Paste", model, modelId, changes, before, cells, false);
    // pin these originals so moving the selection leaves a copy behind
    this.pasteOrigin = new Set(cells.map((c) => `${c.x},${c.y},${c.z}`));
    this.host.setStatus(`Pasted ${cells.length} voxels — move to leave a copy behind`);
  }

  /** Redraw selection outline/highlight/gizmo from current selection cells. */
  refreshSelectionVisuals(): void {
    if (this.selection && this.selection.cells.length) {
      this.showSelectionOutline();
      this.attachVoxelGizmo(this.selection.modelId, this.selection.cells);
    } else {
      this.selection = null;
      this.selectionBox.visible = false;
      this.selectionHighlight.visible = false;
      if (this.gizmoTarget === "voxels") this.hideGizmo();
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement) return;
    if (!this.interactive) return; // preview is read-only — no edit shortcuts
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === "a") {
      e.preventDefault();
      this.selectAll();
      return;
    }
    if (mod && k === "v") {
      e.preventDefault();
      this.paste();
      return;
    }
    // the rest act on an existing selection
    if (!this.selection) return;
    if (mod && k === "d") {
      e.preventDefault();
      this.clearSelection(); // deselect
    } else if (mod && k === "c") {
      e.preventDefault();
      this.copySelection();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      this.deleteSelection();
    } else if (e.key === "ArrowLeft") this.moveSelection(-1, 0, 0);
    else if (e.key === "ArrowRight") this.moveSelection(1, 0, 0);
    else if (e.key === "ArrowUp") this.moveSelection(0, 1, 0);
    else if (e.key === "ArrowDown") this.moveSelection(0, -1, 0);
    else if (e.key === "PageUp") this.moveSelection(0, 0, 1);
    else if (e.key === "PageDown") this.moveSelection(0, 0, -1);
  };

  // --- cursor + placeholder rendering ---
  private meshPosFor(t: VoxelTarget): THREE.Vector3 {
    return (
      this.host.scene.meshFor(t.placement)?.position.clone() ??
      this.host.scene.positionFor(t.placement, t.model)
    );
  }

  /** Current paint color as a THREE.Color (from the palette, sRGB). */
  private currentColor(): THREE.Color {
    const c = this.host.doc.palette.get(this.color);
    return new THREE.Color().setRGB(c.r / 255, c.g / 255, c.b / 255, THREE.SRGBColorSpace);
  }

  private hidePlaceholders(): void {
    this.cursor.visible = false;
    this.faceQuad.visible = false;
    this.regionBox.visible = false;
    this.regionOutline.visible = false;
  }

  /** CSS cursor for the current tool/mode. */
  private cssCursor(): string {
    if (this.tool === "eyedropper") return "pointer";
    if (this.tool === "select") {
      if (this.selectMode === "rect") return "crosshair";
      return "pointer"; // box + same color
    }
    return "crosshair"; // attach / erase / paint / fill
  }

  /** Show the unit wireframe box at a cell (erase / select-box hover). */
  private showWireCursor(cell: Cell, meshPos: THREE.Vector3, hex: number): void {
    this.cursor.position.set(
      meshPos.x + cell.x + 0.5,
      meshPos.y + cell.z + 0.5,
      meshPos.z + cell.y + 0.5
    );
    (this.cursor.material as THREE.LineBasicMaterial).color.setHex(hex);
    this.cursor.visible = true;
  }

  /** Show the pointed face quad (paint/fill in color, pick in yellow). */
  private showFaceQuad(t: VoxelTarget, color: THREE.Color): void {
    const solid = t.solid ?? t.empty;
    const meshPos = this.meshPosFor(t);
    const n = t.normal; // three-space outward normal of the pointed face
    const cx = meshPos.x + solid.x + 0.5 + n.x * 0.5;
    const cy = meshPos.y + solid.z + 0.5 + n.y * 0.5;
    const cz = meshPos.z + solid.y + 0.5 + n.z * 0.5;
    this.faceQuad.position.set(cx + n.x * 0.012, cy + n.y * 0.012, cz + n.z * 0.012);
    this.faceQuad.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    (this.faceQuad.material as THREE.MeshBasicMaterial).color.copy(color);
    this.faceQuad.visible = true;
  }

  private updateCursor(target: VoxelTarget | null): void {
    // hovering a gizmo handle: let the gizmo own the cursor, show no placeholder
    if (this.overGizmo()) {
      this.canvas.style.cursor = "default";
      this.hidePlaceholders();
      return;
    }
    this.canvas.style.cursor = this.cssCursor();
    if (this.regionAnchor) return; // dragging a region: handled by preview
    this.hidePlaceholders();
    if (!target) return;
    const meshPos = this.meshPosFor(target);

    switch (this.tool) {
      case "attach": {
        // ghost of the voxel(s) to be placed, current color at 50%
        const c = target.empty;
        this.regionBox.geometry.dispose();
        this.regionBox.geometry = new THREE.BoxGeometry(1, 1, 1);
        this.regionBox.position.set(
          meshPos.x + c.x + 0.5,
          meshPos.y + c.z + 0.5,
          meshPos.z + c.y + 0.5
        );
        (this.regionBox.material as THREE.MeshBasicMaterial).color.copy(this.currentColor());
        this.regionBox.visible = true;
        break;
      }
      case "erase":
        this.showFaceQuad(target, new THREE.Color(0xff4444));
        break;
      case "paint":
      case "fill":
        this.showFaceQuad(target, this.currentColor());
        break;
      case "eyedropper":
        this.showFaceQuad(target, new THREE.Color(0xffdd33));
        break;
      case "select":
        if (this.selectMode === "box")
          this.showWireCursor(target.solid ?? target.empty, meshPos, 0x00ff88);
        // rect / color: no placeholder
        break;
    }
  }

  private updateRegionPreview(a: Cell, b: Cell): void {
    if (!this.regionPlacement) return;
    const model = this.host.doc.models[this.regionPlacement.modelId];
    const meshPos = this.host.scene.positionFor(this.regionPlacement, model);
    const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
    const minZ = Math.min(a.z, b.z), maxZ = Math.max(a.z, b.z);
    const sx = maxX - minX + 1, sy = maxY - minY + 1, sz = maxZ - minZ + 1;
    this.hidePlaceholders();
    const px = meshPos.x + minX + sx / 2;
    const py = meshPos.y + minZ + sz / 2;
    const pz = meshPos.z + minY + sy / 2;

    if (this.tool === "select") {
      // box select: wireframe outline only (no filled blocks, no x-ray)
      this.regionOutline.geometry.dispose();
      this.regionOutline.geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(sx, sz, sy));
      this.regionOutline.position.set(px, py, pz);
      (this.regionOutline.material as THREE.LineBasicMaterial).color.setHex(0x00ff88);
      this.regionOutline.visible = true;
    } else {
      // attach/paint: translucent fill in current color; erase: red
      this.regionBox.geometry.dispose();
      this.regionBox.geometry = new THREE.BoxGeometry(sx, sz, sy);
      this.regionBox.position.set(px, py, pz);
      const m = this.regionBox.material as THREE.MeshBasicMaterial;
      const erasing = this.tool === "erase" || (this.tool === "attach" && this.regionErase);
      if (erasing) m.color.setHex(0xff4444);
      else m.color.copy(this.currentColor());
      this.regionBox.visible = true;
    }
  }

  // --- gizmo control ---
  /** Show the gizmo handles. Voxel selections get all three (scale/move/rotate);
   *  whole-object selections get move only (object scale/rotate isn't supported). */
  private showGizmoHelper(on: boolean): void {
    const objectOnly = this.gizmoTarget === "object";
    for (const g of this.gizmos) {
      const show = on && (!objectOnly || g.mode === "translate");
      g.helper.visible = show;
      // never re-enable a sibling while a different gizmo owns the drag
      g.tc.enabled = show && (!this.activeGizmo || g === this.activeGizmo);
    }
  }

  private hideGizmo(): void {
    this.gizmoTarget = null;
    this.selectedObject = null;
    this.showGizmoHelper(false);
  }

  /** Place the gizmo on the current voxel selection. */
  private attachVoxelGizmo(modelId: number, cells: Cell[]): void {
    if (this.gizmos.length === 0 || cells.length === 0) {
      this.hideGizmo();
      return;
    }
    const doc = this.host.doc;
    const model = doc.models[modelId];
    const p = doc.placements.find((pl) => pl.modelId === modelId);
    if (!model || !p) return;
    const meshPos = this.host.scene.positionFor(p, model);
    const center = this.cellsCenterThree(cells); // three-local center
    this.gizmoTarget = "voxels";
    this.proxy.position.copy(meshPos).add(center);
    this.proxy.rotation.set(0, 0, 0);
    this.proxy.scale.set(1, 1, 1);
    this.showGizmoHelper(true);
  }

  /** Place the gizmo on a whole object (world view: translate only). */
  attachObjectGizmo(placement: Placement): void {
    if (this.gizmos.length === 0) return;
    const model = this.host.doc.models[placement.modelId];
    if (!model) return;
    const meshPos = this.host.scene.positionFor(placement, model);
    const center = new THREE.Vector3(model.sizeX / 2, model.sizeZ / 2, model.sizeY / 2);
    this.gizmoTarget = "object";
    this.selectedObject = placement;
    this.proxy.position.copy(meshPos).add(center);
    this.proxy.rotation.set(0, 0, 0);
    this.proxy.scale.set(1, 1, 1);
    this.showGizmoHelper(true);
  }

  /** three-local center of a set of cells (cell-center coords). */
  private cellsCenterThree(cells: Cell[]): THREE.Vector3 {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const c of cells) {
      const tx = c.x, ty = c.z, tz = c.y; // three
      minX = Math.min(minX, tx); maxX = Math.max(maxX, tx);
      minY = Math.min(minY, ty); maxY = Math.max(maxY, ty);
      minZ = Math.min(minZ, tz); maxZ = Math.max(maxZ, tz);
    }
    return new THREE.Vector3((minX + maxX + 1) / 2, (minY + maxY + 1) / 2, (minZ + maxZ + 1) / 2);
  }

  private beginGizmo(): void {
    if (this.gizmoTarget === "voxels") this.beginVoxelSession();
    else if (this.gizmoTarget === "object") this.beginObjectSession();
  }
  private applyGizmo(): void {
    if (this.gizmoTarget === "voxels") this.applyVoxelLive();
    else if (this.gizmoTarget === "object") this.applyObjectLive();
  }
  private commitGizmo(): void {
    if (this.gizmoTarget === "voxels") this.commitVoxelSession();
    else if (this.gizmoTarget === "object") this.commitObjectSession();
  }

  private recSet(
    rec: Map<string, { x: number; y: number; z: number; before: number }>,
    model: VoxelModel,
    x: number,
    y: number,
    z: number,
    val: number
  ): void {
    if (!model.inBounds(x, y, z)) return;
    const k = `${x},${y},${z}`;
    if (!rec.has(k)) rec.set(k, { x, y, z, before: model.get(x, y, z) });
    model.set(x, y, z, val);
  }

  private beginVoxelSession(): void {
    const sel = this.selection;
    if (!sel) return;
    const model = this.host.doc.models[sel.modelId];
    const center = this.cellsCenterThree(sel.cells);
    const rel = sel.cells.map((c) => ({
      v: new THREE.Vector3(c.x + 0.5, c.z + 0.5, c.y + 0.5).sub(center),
      color: model.get(c.x, c.y, c.z),
    }));
    const p = this.host.doc.placements.find((pl) => pl.modelId === sel.modelId)!;
    // snapshot the model BEFORE lifting the originals (used to rebuild on a
    // volume-growing commit and to undo it)
    const beginSnap = model.snapshot();
    const beginT: [number, number, number] = [...p.t];

    const rec = new Map<string, { x: number; y: number; z: number; before: number }>();
    // pinned paste originals stay; everything else is lifted (cleared) so the
    // transform moves it.
    const protectedKeys = new Set(this.pasteOrigin ?? []);
    for (const c of sel.cells) {
      if (protectedKeys.has(`${c.x},${c.y},${c.z}`)) continue;
      this.recSet(rec, model, c.x, c.y, c.z, 0);
    }
    this.voxSession = {
      modelId: sel.modelId,
      localCenter: center,
      startPos: this.proxy.position.clone(),
      rel,
      rec,
      last: [],
      selBefore: sel.cells.slice(),
      protectedKeys,
      beginSnap,
      beginT,
    };
    this.host.scene.syncModel(sel.modelId);
  }

  /** The (unclamped) model cells produced by the current proxy transform. */
  private transformedCells(): Array<{ x: number; y: number; z: number; color: number }> {
    const s = this.voxSession!;
    const t = this.proxy.position.clone().sub(s.startPos);
    const tx = Math.round(t.x), ty = Math.round(t.y), tz = Math.round(t.z);
    const R = quantizeRotation(this.proxy.quaternion);
    const sx = Math.max(1, Math.round(this.proxy.scale.x));
    const sy = Math.max(1, Math.round(this.proxy.scale.y));
    const sz = Math.max(1, Math.round(this.proxy.scale.z));
    const seen = new Set<string>();
    const out: Array<{ x: number; y: number; z: number; color: number }> = [];
    for (const { v, color } of s.rel) {
      const scaled = new THREE.Vector3(v.x * sx, v.y * sy, v.z * sz);
      const rot = applyR(R, scaled);
      const bx = Math.round(s.localCenter.x + rot.x + tx - sx / 2);
      const by = Math.round(s.localCenter.y + rot.y + ty - sy / 2);
      const bz = Math.round(s.localCenter.z + rot.z + tz - sz / 2);
      for (let i = 0; i < sx; i++)
        for (let j = 0; j < sy; j++)
          for (let k = 0; k < sz; k++) {
            const mx = bx + i, my = bz + k, mz = by + j; // three -> model
            const key = `${mx},${my},${mz}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ x: mx, y: my, z: mz, color });
          }
    }
    return out;
  }

  private applyVoxelLive(): void {
    const s = this.voxSession;
    if (!s) return;
    const model = this.host.doc.models[s.modelId];
    // clear last frame's stamp (but never the protected floating-paste originals)
    for (const k of s.last) {
      if (s.protectedKeys.has(k)) continue;
      const [x, y, z] = k.split(",").map(Number);
      this.recSet(s.rec, model, x, y, z, 0);
    }
    s.last = [];
    // live preview clamps to current bounds; growth happens on commit
    for (const c of this.transformedCells()) {
      if (!model.inBounds(c.x, c.y, c.z)) continue;
      this.recSet(s.rec, model, c.x, c.y, c.z, c.color);
      s.last.push(`${c.x},${c.y},${c.z}`);
    }
    this.host.scene.syncModel(s.modelId);
  }

  private commitVoxelSession(): void {
    const s = this.voxSession;
    if (!s) return;
    const model = this.host.doc.models[s.modelId];
    const final = this.transformedCells();
    this.voxSession = null;

    if (!this.anyOutOfBounds(model, final)) {
      // in-bounds: live state is the final state; record a cell diff
      const changes: VoxelChange[] = [];
      for (const r of s.rec.values()) {
        const after = model.get(r.x, r.y, r.z);
        if (r.before !== after) changes.push({ x: r.x, y: r.y, z: r.z, before: r.before, after });
      }
      const after: Cell[] = s.last.map((k) => {
        const [x, y, z] = k.split(",").map(Number);
        return { x, y, z };
      });
      this.commitSelectionEdit("Transform selection", model, s.modelId, changes, s.selBefore, after, true);
      return;
    }

    // out of bounds: grow the volume. Rebuild from the drag-start snapshot.
    const p = this.host.doc.placements.find((pl) => pl.modelId === s.modelId)!;
    model.restore(s.beginSnap);
    for (const c of s.selBefore) {
      if (this.pasteOrigin?.has(`${c.x},${c.y},${c.z}`)) continue;
      model.set(c.x, c.y, c.z, 0); // lift the originals
    }
    const shift = this.growModelToFit(s.modelId, final);
    for (const c of final) model.set(c.x + shift.x, c.y + shift.y, c.z + shift.z, c.color);
    if (this.pasteOrigin) this.pasteOrigin = shiftKeys(this.pasteOrigin, shift);
    const seen = new Set<string>();
    const after: Cell[] = [];
    for (const c of final) {
      const k = `${c.x + shift.x},${c.y + shift.y},${c.z + shift.z}`;
      if (seen.has(k)) continue;
      seen.add(k);
      after.push({ x: c.x + shift.x, y: c.y + shift.y, z: c.z + shift.z });
    }
    this.selection = { modelId: s.modelId, cells: after };
    this.pushSnapshotCommand(
      "Transform selection",
      s.modelId,
      s.beginSnap,
      model.snapshot(),
      s.beginT,
      [...p.t],
      s.selBefore,
      after
    );
  }

  private beginObjectSession(): void {
    if (!this.selectedObject) return;
    this.objSession = {
      placement: this.selectedObject,
      startPos: this.proxy.position.clone(),
      startT: [...this.selectedObject.t],
    };
  }
  private applyObjectLive(): void {
    const s = this.objSession;
    if (!s) return;
    const d = this.proxy.position.clone().sub(s.startPos);
    // three delta -> voxel (x, y=depth from three-z, z=up from three-y)
    s.placement.t = [
      s.startT[0] + Math.round(d.x),
      s.startT[1] + Math.round(d.z),
      s.startT[2] + Math.round(d.y),
    ];
    this.host.scene.repositionPlacement(s.placement);
  }
  private commitObjectSession(): void {
    const s = this.objSession;
    if (!s) return;
    const p = s.placement;
    const oldT: [number, number, number] = [...s.startT];
    const newT: [number, number, number] = [...p.t];
    this.objSession = null;
    if (oldT.join() !== newT.join()) {
      this.host.history.push({
        label: "Move object",
        apply: () => { p.t = [...newT]; },
        undo: () => { p.t = [...oldT]; },
      });
    }
    this.host.onObjectMoved?.();
  }

  /** True while the pointer is over a gizmo handle (so editing should defer). */
  private overGizmo(): boolean {
    return this.gizmos.some((g) => (g.tc as unknown as { axis: string | null }).axis);
  }

  clearSelection(): void {
    this.selection = null;
    this.pasteOrigin = null;
    this.selectionBox.visible = false;
    this.selectionHighlight.visible = false;
    if (this.gizmoTarget === "voxels") this.hideGizmo();
    this.host.onSelectionChange?.();
  }
  /** Current selection (cells + model), or null. */
  get selectionInfo(): { modelId: number; cells: Cell[] } | null {
    return this.selection;
  }

  /** Test hook: run the gizmo transform pipeline with an explicit transform. */
  __gizmoTest(opts: { t?: [number, number, number]; rotAxis?: "x" | "y" | "z"; scale?: number }): void {
    if (!this.selection) return;
    this.attachVoxelGizmo(this.selection.modelId, this.selection.cells);
    this.beginVoxelSession();
    if (opts.t) this.proxy.position.add(new THREE.Vector3(...opts.t));
    if (opts.rotAxis) {
      const axis = new THREE.Vector3(
        opts.rotAxis === "x" ? 1 : 0,
        opts.rotAxis === "y" ? 1 : 0,
        opts.rotAxis === "z" ? 1 : 0
      );
      this.proxy.quaternion.setFromAxisAngle(axis, Math.PI / 2);
    }
    if (opts.scale) this.proxy.scale.setScalar(opts.scale);
    this.applyVoxelLive();
    this.commitVoxelSession();
  }
  hideCursor(): void {
    this.hidePlaceholders();
  }
}

/** All cells in the inclusive AABB between a and b. */
function boxCells(a: Cell, b: Cell): Cell[] {
  const out: Cell[] = [];
  const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const [z0, z1] = [Math.min(a.z, b.z), Math.max(a.z, b.z)];
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) out.push({ x, y, z });
  return out;
}
