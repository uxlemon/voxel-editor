import * as THREE from "three";
import { Viewport } from "./Viewport";

/**
 * A small interactive ViewCube (MagicaVoxel-style orientation gizmo) rendered
 * in its own canvas overlay in a corner. It mirrors the main camera's
 * orientation, shows colored XYZ axes, and snaps the main camera to a face
 * direction when clicked.
 *
 * World/three axis mapping shown on the cube: X=red (three-x), the up axis is
 * model-Z = three-y shown blue, and depth model-Y = three-z shown green —
 * matching the rest of the editor.
 */
export class ViewCube {
  private el: HTMLDivElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private cube: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private size = 156;

  constructor(private viewport: Viewport) {
    this.el = document.createElement("div");
    this.el.className = "viewcube";
    this.el.title = "Click a face to snap the view";
    const canvas = document.createElement("canvas");
    this.el.appendChild(canvas);
    document.body.appendChild(this.el);

    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.size, this.size, false);

    this.camera = new THREE.OrthographicCamera(-1.7, 1.7, 1.7, -1.7, 0.1, 100);

    this.cube = this.buildCube();
    this.scene.add(this.cube);

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    // render after the main pass each frame, syncing orientation
    this.viewport.addOverlayCallback(() => this.renderFrame());
  }

  private dragging = false;
  private moved = false;
  private lastX = 0;
  private lastY = 0;

  private buildCube(): THREE.Mesh {
    const labels: Array<[string, number]> = [
      ["RIGHT", 0xb05050], // +x
      ["LEFT", 0x804040], // -x
      ["TOP", 0x5070b0], // +y (model Z up)
      ["BOTTOM", 0x405080], // -y
      ["FRONT", 0x50a060], // +z (model Y)
      ["BACK", 0x408050], // -z
    ];
    // Unlit material so the texture renders at full brightness — the white
    // label text stays white and the #eef0f4 border matches the page bg
    // (Lambert lighting would otherwise darken both into gray).
    const mats = labels.map(
      ([text, color]) =>
        new THREE.MeshBasicMaterial({ map: this.labelTexture(text, color) })
    );
    return new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), mats);
  }

  private labelTexture(text: string, color: number): THREE.CanvasTexture {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = "#eef0f4"; // editor background color
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 122, 122);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private onPointerDown = (e: PointerEvent): void => {
    e.stopPropagation();
    try {
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    } catch {
      /* no active pointer (e.g. synthetic event) — capture is optional */
    }
    this.dragging = true;
    this.moved = false;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 2) this.moved = true;
    // drag the cube to orbit the main camera
    this.viewport.orbit(dx * 0.012, dy * 0.012);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = false;
    (e.target as HTMLCanvasElement).releasePointerCapture?.(e.pointerId);
    if (this.moved) return; // it was a drag, not a click — don't snap
    // click without drag: snap the view to the clicked face
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.cube, false)[0];
    if (hit && hit.face) this.viewport.snapTo(hit.face.normal.clone());
  };

  private renderFrame(): void {
    // orient the cube camera to match the main camera's view direction
    const main = this.viewport.camera;
    const target = this.viewport.controls.target;
    const dir = main.position.clone().sub(target);
    if (dir.lengthSq() < 1e-6) return;
    dir.normalize();
    this.camera.position.copy(dir.multiplyScalar(4));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  }
}
