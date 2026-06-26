import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type Projection = "pers" | "orth";

/**
 * Owns the Three.js renderer, scene, cameras (perspective + orthographic),
 * orbit controls and lights. Image-based lighting + ACES tone mapping are
 * always on for a high-quality look while editing. Floor/wall grids and the
 * colored XYZ axis bars come from the editable VolumeBox. Editor content
 * (voxel meshes, cursors, gizmos) is added to {@link content}.
 */
export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly controls: OrbitControls;
  readonly content: THREE.Group;

  private perspCamera: THREE.PerspectiveCamera;
  private orthoCamera: THREE.OrthographicCamera;
  private activeCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  projection: Projection = "pers";
  /** half-height of the framed content, used to keep ortho/persp consistent. */
  private viewRadius = 32;

  private readonly canvas: HTMLCanvasElement;
  private animHandle = 0;
  private zoomAnim = 0;
  private reframeAnim = 0;
  private autoSpin = false;
  private frameCallbacks: Array<(camera: THREE.Camera) => void> = [];
  private overlayCallbacks: Array<(camera: THREE.Camera) => void> = [];

  // --- ambient parallax tilt (home preview) ---
  private tiltTargetX = 0;
  private tiltTargetY = 0;
  private tiltCurX = 0;
  private tiltCurY = 0;
  private tiltAppliedX = 0;
  private tiltAppliedY = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true, // transparent so the headline behind the canvas shows through
      preserveDrawingBuffer: true, // for PNG screenshot export
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Neutral tone mapping so rendered colors match the sRGB palette exactly.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.autoClear = false; // we clear manually (main + viewcube overlay)
    this.renderer.setClearColor(0x000000, 0); // transparent clear

    this.scene = new THREE.Scene();
    this.scene.background = null; // page/stage background shows through

    this.perspCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 6000);
    this.perspCamera.position.set(48, 48, 72);
    this.orthoCamera = new THREE.OrthographicCamera(-50, 50, 50, -50, -2000, 6000);
    this.orthoCamera.position.copy(this.perspCamera.position);
    this.activeCamera = this.perspCamera;

    this.controls = new OrbitControls(this.activeCamera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.target.set(0, 16, 0);
    // Plain wheel scrolls the page (to reach the gallery); only Cmd/Ctrl+wheel
    // zooms the model, so the two never conflict.
    this.controls.enableZoom = false;
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.dolly(e.deltaY);
        }
        // otherwise let the event bubble so #app scrolls
      },
      { passive: false }
    );

    this.content = new THREE.Group();
    this.scene.add(this.content);
    // Voxels are unlit (shading baked into vertex colors), so no scene lights.

    window.addEventListener("resize", this.onResize);
    this.onResize();
    this.start();
  }

  get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.activeCamera;
  }

  /** Switch between perspective and orthographic projection, keeping the view. */
  setProjection(mode: Projection): void {
    if (mode === this.projection) return;
    const from = this.activeCamera;
    const to = mode === "pers" ? this.perspCamera : this.orthoCamera;
    to.position.copy(from.position);
    this.projection = mode;
    this.activeCamera = to;
    this.controls.object = to;
    this.onResize();
    this.controls.update();
  }

  /**
   * Frame content of the given voxel dimensions: recenters the target and pulls
   * the camera back to fit. Works for both projections.
   */
  frameModel(sizeX: number, sizeY: number, sizeZ: number): void {
    const center = new THREE.Vector3(0, sizeZ / 2, 0);
    const radius = Math.max(sizeX, sizeY, sizeZ);
    this.viewRadius = radius;
    const dist = radius * 1.9 + 8;
    const dir = new THREE.Vector3(0.8, 0.7, 1).normalize();
    this.controls.target.copy(center);
    const pos = center.clone().addScaledVector(dir, dist);
    this.perspCamera.position.copy(pos);
    this.orthoCamera.position.copy(pos);
    this.perspCamera.near = 0.1;
    this.perspCamera.far = dist * 10 + 2000;
    this.perspCamera.updateProjectionMatrix();
    this.applyOrthoFrustum();
    this.controls.update();
  }

  /** Recenter on the current target without changing distance much. */
  recenter(center: THREE.Vector3, radius: number): void {
    this.viewRadius = radius;
    const dist = radius * 1.9 + 8;
    const dir = new THREE.Vector3(0.8, 0.7, 1).normalize();
    this.controls.target.copy(center);
    const pos = center.clone().addScaledVector(dir, dist);
    this.perspCamera.position.copy(pos);
    this.orthoCamera.position.copy(pos);
    this.applyOrthoFrustum();
    this.perspCamera.updateProjectionMatrix();
    this.controls.update();
  }

  /** Smoothly multiply the camera distance by `factor` over `ms` (eased). Used
   *  for the slight zoom-out when entering the preview and back when editing. */
  animateZoom(factor: number, ms = 320): void {
    if (this.zoomAnim) cancelAnimationFrame(this.zoomAnim);
    const target = this.controls.target.clone();
    const offset = this.perspCamera.position.clone().sub(target);
    const startLen = offset.length();
    const endLen = Math.min(5000, Math.max(2, startLen * factor));
    const dir = offset.clone().normalize();
    const startRadius = this.viewRadius;
    const endRadius = Math.min(4000, Math.max(2, startRadius * factor));
    const t0 = performance.now();
    const step = (now: number): void => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3); // easeOutCubic
      const len = startLen + (endLen - startLen) * e;
      const pos = target.clone().addScaledVector(dir, len);
      this.perspCamera.position.copy(pos);
      this.orthoCamera.position.copy(pos);
      this.viewRadius = startRadius + (endRadius - startRadius) * e;
      this.applyOrthoFrustum();
      this.controls.update();
      if (k < 1) this.zoomAnim = requestAnimationFrame(step);
      else this.zoomAnim = 0;
    };
    this.zoomAnim = requestAnimationFrame(step);
  }

  /** Slowly orbit the model for an idle 360° showcase (preview only). */
  setAutoSpin(on: boolean): void {
    this.autoSpin = on;
  }

  /** Smoothly animate the camera back to a framed, centered view. */
  recenterSmooth(center: THREE.Vector3, radius: number, ms = 520): void {
    if (this.reframeAnim) cancelAnimationFrame(this.reframeAnim);
    this.viewRadius = radius;
    const dist = radius * 1.9 + 8;
    const dir = new THREE.Vector3(0.8, 0.7, 1).normalize();
    const endTarget = center.clone();
    const endPos = center.clone().addScaledVector(dir, dist);
    const startTarget = this.controls.target.clone();
    const startPos = this.perspCamera.position.clone();
    const t0 = performance.now();
    const step = (now: number): void => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      this.controls.target.lerpVectors(startTarget, endTarget, e);
      const p = startPos.clone().lerp(endPos, e);
      this.perspCamera.position.copy(p);
      this.orthoCamera.position.copy(p);
      this.applyOrthoFrustum();
      this.controls.update();
      if (k < 1) this.reframeAnim = requestAnimationFrame(step);
      else this.reframeAnim = 0;
    };
    this.reframeAnim = requestAnimationFrame(step);
  }

  /** Zoom the model in/out (Cmd/Ctrl + wheel). Works for both projections. */
  dolly(deltaY: number): void {
    const scale = deltaY > 0 ? 1.1 : 1 / 1.1;
    const target = this.controls.target;
    const offset = this.perspCamera.position.clone().sub(target);
    offset.setLength(Math.min(5000, Math.max(2, offset.length() * scale)));
    this.perspCamera.position.copy(target).add(offset);
    this.orthoCamera.position.copy(this.perspCamera.position);
    this.viewRadius = Math.min(4000, Math.max(2, this.viewRadius * scale));
    this.applyOrthoFrustum();
    this.controls.update();
  }

  /** Orbit the camera around the target by azimuth/polar deltas (radians). */
  orbit(dTheta: number, dPhi: number): void {
    const target = this.controls.target;
    const offset = this.activeCamera.position.clone().sub(target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    sph.theta -= dTheta;
    sph.phi = Math.max(0.04, Math.min(Math.PI - 0.04, sph.phi - dPhi));
    offset.setFromSpherical(sph);
    const pos = target.clone().add(offset);
    this.perspCamera.position.copy(pos);
    this.orthoCamera.position.copy(pos);
    this.controls.update();
  }

  /** Snap the camera to look along a unit direction (used by the ViewCube). */
  snapTo(dir: THREE.Vector3): void {
    const target = this.controls.target.clone();
    const dist = this.activeCamera.position.distanceTo(target) || this.viewRadius * 2;
    const pos = target.clone().addScaledVector(dir.clone().normalize(), dist);
    this.perspCamera.position.copy(pos);
    this.orthoCamera.position.copy(pos);
    this.controls.update();
  }

  /**
   * Set the ambient tilt target from a normalized cursor offset (-1..1 each
   * axis). The camera eases toward a small rotational offset each frame and
   * eases back to neutral when set to (0,0). Used only on the home preview to
   * make it feel alive; layered on top of user orbit via {@link orbit}.
   */
  setAmbientTilt(nx: number, ny: number): void {
    this.tiltTargetX = Math.max(-1, Math.min(1, nx));
    this.tiltTargetY = Math.max(-1, Math.min(1, ny));
  }

  private applyAmbientTilt(): void {
    const EASE = 0.12;
    this.tiltCurX += (this.tiltTargetX - this.tiltCurX) * EASE;
    this.tiltCurY += (this.tiltTargetY - this.tiltCurY) * EASE;
    const MAX_THETA = 0.16; // ~9°
    const MAX_PHI = 0.1;
    const wantTheta = this.tiltCurX * MAX_THETA;
    const wantPhi = this.tiltCurY * MAX_PHI;
    const dTheta = wantTheta - this.tiltAppliedX;
    const dPhi = wantPhi - this.tiltAppliedY;
    if (Math.abs(dTheta) > 1e-5 || Math.abs(dPhi) > 1e-5) {
      this.orbit(dTheta, dPhi);
      this.tiltAppliedX = wantTheta;
      this.tiltAppliedY = wantPhi;
    }
  }

  /** Public resize hook (e.g. when the stage height changes between modes). */
  resize(): void {
    this.onResize();
  }

  /** Constant horizontal field of view (deg). The vertical FOV is derived from
   *  the aspect so that changing only the viewport HEIGHT (scrolling / entering
   *  full-screen) never rescales the model — the model's on-screen size depends
   *  on width only. */
  private static H_FOV = 60;

  private applyOrthoFrustum(): void {
    const aspect = (this.canvas.clientWidth || 1) / (this.canvas.clientHeight || 1);
    // Fix the horizontal half-extent; derive vertical from aspect so a height
    // change leaves the model's apparent size unchanged.
    const H = this.viewRadius * 1.3;
    this.orthoCamera.left = -H;
    this.orthoCamera.right = H;
    this.orthoCamera.top = H / aspect;
    this.orthoCamera.bottom = -H / aspect;
    this.orthoCamera.updateProjectionMatrix();
  }

  private onResize = (): void => {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / Math.max(1, h);
    this.perspCamera.aspect = aspect;
    const hfov = THREE.MathUtils.degToRad(Viewport.H_FOV);
    this.perspCamera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / aspect));
    this.perspCamera.updateProjectionMatrix();
    this.applyOrthoFrustum();
  };

  /** Pre-render callback (e.g. update VolumeBox face visibility). */
  addFrameCallback(fn: (camera: THREE.Camera) => void): void {
    this.frameCallbacks.push(fn);
  }

  /** Post-render overlay callback (e.g. the ViewCube draws into a corner). */
  addOverlayCallback(fn: (camera: THREE.Camera) => void): void {
    this.overlayCallbacks.push(fn);
  }

  private start(): void {
    const loop = () => {
      this.animHandle = requestAnimationFrame(loop);
      this.controls.update();
      this.applyAmbientTilt();
      // Idle auto-orbit (preview showcase) — paused while a reframe animates.
      if (this.autoSpin && !this.reframeAnim) this.orbit(-0.0038, 0);
      for (const fn of this.frameCallbacks) fn(this.activeCamera);
      this.renderer.clear();
      this.renderer.render(this.scene, this.activeCamera);
      for (const fn of this.overlayCallbacks) fn(this.activeCamera);
    };
    loop();
  }

  dispose(): void {
    cancelAnimationFrame(this.animHandle);
    window.removeEventListener("resize", this.onResize);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
