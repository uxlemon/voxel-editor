import * as THREE from "three";

/**
 * MagicaVoxel-style editable volume frame: a grid box around the active model.
 * Only the three faces facing away from the camera (the floor + two far walls)
 * are shown, so you look and draw "into" the box; the near walls are hidden.
 *
 * Each shown face carries a faint fill that doubles as a raycast target, so the
 * editor can place voxels directly on the floor or back walls. Axis edges at the
 * origin corner are colored X=red, Y=green, Z=blue to match MagicaVoxel.
 *
 * Box space matches the model's local render space: model voxel (x,y,z) (z up)
 * maps to Three.js (x, z, y). The box therefore spans (sizeX, sizeZ, sizeY) and
 * is positioned at the active model's mesh position.
 */

export type FaceKind = "floor" | "ceil" | "left" | "right" | "front" | "back";

interface Face {
  kind: FaceKind;
  normal: THREE.Vector3; // outward (away from box interior), three-space
  centerLocal: THREE.Vector3;
  group: THREE.Group;
  fill: THREE.Mesh;
}

export class VolumeBox {
  readonly group = new THREE.Group();
  private faces: Face[] = [];
  private edges: THREE.LineSegments | null = null;
  private sizeX = 0;
  private sizeY = 0;
  private sizeZ = 0;
  visible = true;

  constructor(parent: THREE.Object3D) {
    parent.add(this.group);
  }

  /** Rebuild the box for the given model dimensions (in voxels). */
  build(sizeX: number, sizeY: number, sizeZ: number): void {
    if (sizeX === this.sizeX && sizeY === this.sizeY && sizeZ === this.sizeZ) return;
    this.sizeX = sizeX;
    this.sizeY = sizeY;
    this.sizeZ = sizeZ;
    this.dispose();

    const X = sizeX; // three-x
    const Y = sizeZ; // three-y (up)
    const Z = sizeY; // three-z (depth)

    const defs: Array<{
      kind: FaceKind;
      o: [number, number, number];
      u: [number, number, number];
      uc: number;
      v: [number, number, number];
      vc: number;
      n: [number, number, number];
    }> = [
      { kind: "floor", o: [0, 0, 0], u: [1, 0, 0], uc: X, v: [0, 0, 1], vc: Z, n: [0, -1, 0] },
      { kind: "ceil", o: [0, Y, 0], u: [1, 0, 0], uc: X, v: [0, 0, 1], vc: Z, n: [0, 1, 0] },
      { kind: "left", o: [0, 0, 0], u: [0, 0, 1], uc: Z, v: [0, 1, 0], vc: Y, n: [-1, 0, 0] },
      { kind: "right", o: [X, 0, 0], u: [0, 0, 1], uc: Z, v: [0, 1, 0], vc: Y, n: [1, 0, 0] },
      { kind: "front", o: [0, 0, 0], u: [1, 0, 0], uc: X, v: [0, 1, 0], vc: Y, n: [0, 0, -1] },
      { kind: "back", o: [0, 0, Z], u: [1, 0, 0], uc: X, v: [0, 1, 0], vc: Y, n: [0, 0, 1] },
    ];

    for (const d of defs) {
      const g = new THREE.Group();
      // Floor and ceiling dots are lighter than the wall dots.
      const dotColor = d.kind === "floor" || d.kind === "ceil" ? 0xc7ccd6 : 0x9099a8;
      const grid = makeFaceGrid(d.o, d.u, d.uc, d.v, d.vc, dotColor);
      const fill = makeFaceFill(d.o, d.u, d.uc, d.v, d.vc);
      fill.userData.faceKind = d.kind;
      g.add(grid, fill);
      this.group.add(g);
      this.faces.push({
        kind: d.kind,
        normal: new THREE.Vector3(...d.n),
        centerLocal: new THREE.Vector3(
          d.o[0] + (d.u[0] * d.uc + d.v[0] * d.vc) / 2,
          d.o[1] + (d.u[1] * d.uc + d.v[1] * d.vc) / 2,
          d.o[2] + (d.u[2] * d.uc + d.v[2] * d.vc) / 2
        ),
        group: g,
        fill,
      });
    }

    // No box outline — the dotted faces define the volume.

    // Axis orientation is shown on the ViewCube (MagicaVoxel-style), not on the
    // box itself.
  }

  setPosition(p: THREE.Vector3): void {
    this.group.position.copy(p);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.group.visible = v;
  }

  /** Show only faces pointing away from the camera (floor + far walls). */
  updateVisibility(camera: THREE.Camera): void {
    if (!this.visible) return;
    const camPos = camera.position;
    for (const f of this.faces) {
      const centerWorld = f.centerLocal.clone().add(this.group.position);
      const toCam = camPos.clone().sub(centerWorld);
      // show when the face points away from the camera
      f.group.visible = f.normal.dot(toCam) < 0;
    }
  }

  /** Raycast targets for the editor (visible face fills). */
  get pickTargets(): THREE.Object3D[] {
    return this.faces.filter((f) => f.group.visible).map((f) => f.fill);
  }

  /**
   * Given a hit on a face fill and the world hit point, return the voxel cell to
   * place against that face (the interior boundary layer), or null if outside.
   */
  cellForHit(fillMesh: THREE.Object3D, point: THREE.Vector3): { x: number; y: number; z: number } | null {
    const kind = fillMesh.userData.faceKind as FaceKind;
    const l = point.clone().sub(this.group.position);
    const fx = Math.floor(l.x); // model x
    const fz = Math.floor(l.y); // model z (up)
    const fy = Math.floor(l.z); // model y (depth)
    let x = fx, y = fy, z = fz;
    switch (kind) {
      case "floor": z = 0; break;
      case "ceil": z = this.sizeZ - 1; break;
      case "left": x = 0; break;
      case "right": x = this.sizeX - 1; break;
      case "front": y = 0; break;
      case "back": y = this.sizeY - 1; break;
    }
    if (x < 0 || y < 0 || z < 0 || x >= this.sizeX || y >= this.sizeY || z >= this.sizeZ)
      return null;
    return { x, y, z };
  }

  dispose(): void {
    for (const f of this.faces) {
      f.group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
      });
      this.group.remove(f.group);
    }
    this.faces = [];
    if (this.edges) {
      this.edges.geometry.dispose();
      this.group.remove(this.edges);
      this.edges = null;
    }
  }
}

function makeFaceGrid(
  o: [number, number, number],
  u: [number, number, number],
  uc: number,
  v: [number, number, number],
  vc: number,
  color = 0x9099a8
): THREE.Points {
  // A dot at every grid intersection instead of full grid lines.
  const pts: number[] = [];
  const O = new THREE.Vector3(...o);
  const U = new THREE.Vector3(...u);
  const V = new THREE.Vector3(...v);
  for (let i = 0; i <= uc; i++) {
    for (let j = 0; j <= vc; j++) {
      const p = O.clone().addScaledVector(U, i).addScaledVector(V, j);
      pts.push(p.x, p.y, p.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.Points(
    g,
    new THREE.PointsMaterial({
      color,
      size: 2.4,
      sizeAttenuation: false, // constant pixel size regardless of zoom
      transparent: true,
      opacity: 0.85,
    })
  );
}

function makeFaceFill(
  o: [number, number, number],
  u: [number, number, number],
  uc: number,
  v: [number, number, number],
  vc: number
): THREE.Mesh {
  const O = new THREE.Vector3(...o);
  const U = new THREE.Vector3(...u).multiplyScalar(uc);
  const V = new THREE.Vector3(...v).multiplyScalar(vc);
  const p0 = O;
  const p1 = O.clone().add(U);
  const p2 = O.clone().add(U).add(V);
  const p3 = O.clone().add(V);
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z,
        p0.x, p0.y, p0.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z,
      ],
      3
    )
  );
  g.computeVertexNormals();
  // Invisible fill: no gray background, but still a raycast target so the
  // editor can place voxels on the floor / back walls.
  const mat = new THREE.MeshBasicMaterial({
    color: 0x2f2f33,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  return new THREE.Mesh(g, mat);
}
